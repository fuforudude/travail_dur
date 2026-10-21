// Fonction serveur du tower defense (Supabase Edge Function, Deno).
//
// Le serveur garde l'état de chaque partie. Au lancement, il vérifie le mode (niveau de la
// campagne débloqué, héros possédé et son niveau, améliorations de la boutique à étoiles) et tire la graine. À la fin de chaque vague, il reçoit les actions du
// joueur (avant et pendant la vague, datées au tick près), rejoue la vague avec le même moteur
// que le jeu (./engine, copié depuis src/ par scripts/td-sync.mjs) et enregistre le résultat
// dans td_sessions ; le déclencheur points_on_td attribue alors les points.
//
// Déploiement : `npm run td:sync` puis `npx supabase functions deploy td` (voir le README).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { HEROES } from './engine/data.ts';
import { newRun, replayWave, runError, starsOf, type RunState } from './engine/sim.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class Refused extends Error {}

// Version du protocole du site (TD_PROTOCOL dans src/games/towerdefense/net.ts). Un onglet resté
// ouvert sur un vieux code ne démarre plus de partie : il est invité à recharger la page.
const PROTOCOL = 2;
const OUTDATED = 'nouvelle version du jeu : recharge la page (Ctrl+F5)';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function start(uid: string, mode: unknown, level: unknown, hero: unknown) {
  // Les choix du client ne sont pas considérés comme acquis : la progression et la possession
  // sont relues en base avant de créer un état initial avec une graine choisie par le serveur.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from('td_sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid).gt('started_at', since);
  if ((count ?? 0) >= 10) throw new Refused('trop de parties, réessaie dans une minute');
  if (mode !== 'campaign' && mode !== 'infinite') throw new Refused('mode inconnu');
  if (hero !== null && (typeof hero !== 'string' || !HEROES.some((h) => h.id === hero))) throw new Refused('héros inconnu');
  const [{ data: cleared, error: e1 }, { data: owned, error: e2 }, { data: perkRows, error: e3 }, { data: cleared2, error: e4 }] = await Promise.all([
    db.rpc('td_cleared', { uid }),
    hero ? db.from('td_heroes').select('level').eq('user_id', uid).eq('hero_id', hero).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('td_perks').select('perk_id, rank').eq('user_id', uid),
    db.rpc('td_cleared2', { uid }), // chapitre 2 (0040_chapitre2.sql)
  ]);
  if (e1 || e2 || e3 || e4) throw new Error((e1 ?? e2 ?? e3 ?? e4)!.message);
  if (hero && !owned) throw new Refused('héros pas encore obtenu');
  const options = {
    mode, level: mode === 'campaign' ? Number(level) : 0, cleared: Number(cleared ?? 0), cleared2: Number(cleared2 ?? 0),
    hero: hero && owned ? { id: hero as string, level: Number(owned.level) } : null,
    perks: Object.fromEntries((perkRows ?? []).map((r) => [String(r.perk_id), Number(r.rank)])),
  } as const;
  const err = runError(options);
  if (err) throw new Refused(err);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const state = newRun(seed, options);
  const { data, error } = await db
    .from('td_sessions')
    .insert({
      user_id: uid, rules: 3, mode, level: options.mode === 'campaign' ? options.level : null, hero: options.hero?.id ?? null,
      hero_level: options.hero?.level ?? null, seed, state, wave: 0, lives: state.lives, gold: state.gold, kills: 0,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, state };
}

async function wave(uid: string, session: unknown, actions: unknown, step: unknown) {
  if (typeof session !== 'string' || !/^[0-9a-f-]{36}$/.test(session)) throw new Refused('partie inconnue');
  if (typeof actions !== 'string' || actions.length > 20000) throw new Refused('actions invalides');
  const { data: row, error } = await db
    .from('td_sessions')
    .select('user_id, rules, over, state, step, last_call_at, wave, lives, gold, kills, won, stars')
    .eq('id', session)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.user_id !== uid || row.rules !== 3 || !row.state) throw new Refused('partie inconnue');
  // `step` (nombre de vagues déjà envoyées, selon le site) rend l'envoi rejouable sans risque : une
  // vague déjà reçue (le site n'a pas eu la réponse, page rechargée…) n'est pas rejouée une 2e fois.
  if (step !== undefined) {
    if (!Number.isInteger(step) || (step as number) < 0) throw new Refused('vague inconnue');
    if ((step as number) < row.step) {
      return { wave: row.wave, lives: row.lives, gold: row.gold, kills: row.kills, over: row.over, won: row.won, stars: row.stars, already: true };
    }
    if ((step as number) > row.step) throw new Refused('vague manquante');
  }
  if (row.over) throw new Refused('partie terminée');
  const s = row.state as RunState;
  let ticks: number;
  try {
    // `replayWave` valide les actions et fait évoluer l'état enregistré ; on ne reçoit jamais un
    // état calculé par le navigateur comme résultat de la vague.
    ticks = replayWave(s, actions);
  } catch (e) {
    throw new Refused((e as Error).message);
  }
  // La vague a duré `ticks` × 100 ms ; le jeu accélère ×3 au maximum (marge ×5 pour le réseau).
  if (Date.now() - Date.parse(row.last_call_at) < ticks * 20) throw new Refused('vague jouée trop vite');
  const { data: saved, error: e2 } = await db
    .from('td_sessions')
    .update({ state: s, wave: s.wave, lives: s.lives, gold: s.gold, kills: s.kills, over: s.over, won: s.won, stars: starsOf(s), last_call_at: new Date().toISOString(), last_ticks: ticks, step: row.step + 1 })
    .eq('id', session)
    .eq('step', row.step)
    .select('id');
  if (e2) throw new Error(e2.message);
  // Le filtre sur `step` agit comme une comparaison-et-échange : deux requêtes concurrentes
  // basées sur la même vague ne peuvent pas toutes deux enregistrer leur résultat.
  if (!saved?.length) throw new Refused('vague déjà envoyée');
  return { wave: s.wave, lives: s.lives, gold: s.gold, kills: s.kills, over: s.over, won: s.won, stars: starsOf(s), ticks };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'méthode non permise' }, 405);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(token);
  const uid = auth?.user?.id;
  if (!uid) return reply({ error: 'non connecté' }, 401);
  const body = await req.json().catch(() => null);
  try {
    if (body?.op === 'ping') return reply({ ok: true });
    if (body?.op === 'start') {
      if (!(Number(body.v) >= PROTOCOL)) throw new Refused(OUTDATED);
      return reply(await start(uid, body.mode, body.level, body.hero ?? null));
    }
    if (body?.op === 'wave') {
      // Les vagues en attente d'un site un peu ancien (avec `step`) restent acceptées : rien ne se perd.
      if (body.step === undefined && !(Number(body.v) >= PROTOCOL)) throw new Refused(OUTDATED);
      return reply(await wave(uid, body.session, body.actions, body.step));
    }
    return reply({ error: 'opération inconnue' }, 400);
  } catch (e) {
    if (e instanceof Refused) return reply({ error: e.message }, 400);
    console.error(e);
    return reply({ error: 'erreur du serveur' }, 500);
  }
});
