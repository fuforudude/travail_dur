// Fonction serveur du tower defense (Supabase Edge Function, Deno).
//
// Le serveur garde l'état de chaque partie. Au lancement, il vérifie le mode (niveau de la
// campagne débloqué, héros possédé et son niveau, améliorations de la boutique à étoiles) et tire la graine. À la fin de chaque vague, il reçoit les actions du
// joueur (avant et pendant la vague, datées au tick près), rejoue la vague avec le même moteur
// que le jeu (./engine, copié depuis src/ par scripts/td-sync.mjs) et enregistre le résultat
// dans td_sessions ; le déclencheur points_on_td attribue alors les points.
//
// Hors ligne : le site garde d'avance un ticket (`reserve` : une partie réservée, graine tirée ici).
// Si le serveur est injoignable au lancement, il joue avec cette graine et envoie plus tard
// `start` avec le ticket et ses réglages, puis les vagues gardées dans le navigateur.
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

/** Ticket pour une partie hors ligne : toujours le même tant qu'il n'a pas servi. */
async function reserve(uid: string) {
  const { data: free, error } = await db.from('td_sessions').select('id, seed').eq('user_id', uid).eq('rules', 3).is('state', null).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (free) return { id: free.id, seed: Number(free.seed) };
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const { data, error: e2 } = await db.from('td_sessions').insert({ user_id: uid, rules: 3, seed, state: null }).select('id').single();
  if (e2) throw new Error(e2.message);
  return { id: data.id, seed };
}

/**
 * Démarre une partie lancée hors ligne avec un ticket. Le site a déjà joué avec ses réglages
 * (progression, niveau du héros, améliorations qu'il connaissait) : on les reprend s'ils ne
 * dépassent pas ce que le joueur possède vraiment, pour rejouer exactement la même partie.
 */
async function startTicket(uid: string, ticket: unknown, o: Record<string, unknown> | null): Promise<{ id: string; state: RunState; already?: boolean }> {
  if (typeof ticket !== 'string' || !/^[0-9a-f-]{36}$/.test(ticket) || !o || typeof o !== 'object') throw new Refused('ticket inconnu');
  const { data: row, error } = await db.from('td_sessions').select('user_id, rules, seed, state, mode').eq('id', ticket).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.user_id !== uid || row.rules !== 3) throw new Refused('ticket inconnu');
  if (row.state) {
    // Déjà démarrée (réponse perdue, renvoi) : rien à refaire.
    if (row.mode === o.mode) return { id: ticket, state: row.state as RunState, already: true };
    throw new Refused('ticket déjà utilisé');
  }
  if (o.mode !== 'campaign' && o.mode !== 'infinite') throw new Refused('mode inconnu');
  const hero = (o.hero ?? null) as { id?: unknown; level?: unknown } | null;
  if (hero !== null && (typeof hero !== 'object' || !HEROES.some((h) => h.id === hero.id) || !Number.isInteger(hero.level) || (hero.level as number) < 1)) {
    throw new Refused('héros inconnu');
  }
  const perks = (o.perks ?? {}) as Record<string, unknown>;
  if (typeof perks !== 'object' || Array.isArray(perks)) throw new Refused('amélioration inconnue');
  const [{ data: cleared, error: e1 }, { data: owned, error: e2 }, { data: perkRows, error: e3 }] = await Promise.all([
    db.rpc('td_cleared', { uid }),
    hero ? db.from('td_heroes').select('level').eq('user_id', uid).eq('hero_id', hero.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('td_perks').select('perk_id, rank').eq('user_id', uid),
  ]);
  if (e1 || e2 || e3) throw new Error((e1 ?? e2 ?? e3)!.message);
  if (hero && (!owned || (hero.level as number) > Number(owned.level))) throw new Refused('héros pas encore obtenu');
  const ranks = new Map((perkRows ?? []).map((r) => [String(r.perk_id), Number(r.rank)]));
  for (const [id, n] of Object.entries(perks)) {
    if (typeof n !== 'number' || n > (ranks.get(id) ?? 0)) throw new Refused('amélioration pas encore achetée');
  }
  const known = Number(o.cleared);
  if (!Number.isInteger(known) || known < 0 || known > Number(cleared ?? 0)) throw new Refused('niveau pas encore débloqué');
  const options = {
    mode: o.mode, level: o.mode === 'campaign' ? Number(o.level) : 0, cleared: known,
    hero: hero ? { id: hero.id as string, level: hero.level as number } : null, perks: perks as Record<string, number>,
  } as const;
  const err = runError(options);
  if (err) throw new Refused(err);
  const state = newRun(Number(row.seed), options);
  const { data: saved, error: e4 } = await db
    .from('td_sessions')
    .update({
      mode: options.mode, level: options.mode === 'campaign' ? options.level : null, hero: options.hero?.id ?? null,
      hero_level: options.hero?.level ?? null, state, wave: 0, lives: state.lives, gold: state.gold, kills: 0,
    })
    .eq('id', ticket)
    .is('state', null)
    .select('id');
  if (e4) throw new Error(e4.message);
  if (!saved?.length) return startTicket(uid, ticket, o); // démarrée entre-temps par un autre envoi
  return { id: ticket, state };
}

async function start(uid: string, mode: unknown, level: unknown, hero: unknown) {
  // Les choix du client ne sont pas considérés comme acquis : la progression et la possession
  // sont relues en base avant de créer un état initial avec une graine choisie par le serveur.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from('td_sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid).gt('started_at', since);
  if ((count ?? 0) >= 10) throw new Refused('trop de parties, réessaie dans une minute');
  if (mode !== 'campaign' && mode !== 'infinite') throw new Refused('mode inconnu');
  if (hero !== null && (typeof hero !== 'string' || !HEROES.some((h) => h.id === hero))) throw new Refused('héros inconnu');
  const [{ data: cleared, error: e1 }, { data: owned, error: e2 }, { data: perkRows, error: e3 }] = await Promise.all([
    db.rpc('td_cleared', { uid }),
    hero ? db.from('td_heroes').select('level').eq('user_id', uid).eq('hero_id', hero).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('td_perks').select('perk_id, rank').eq('user_id', uid),
  ]);
  if (e1 || e2 || e3) throw new Error((e1 ?? e2 ?? e3)!.message);
  if (hero && !owned) throw new Refused('héros pas encore obtenu');
  const options = {
    mode, level: mode === 'campaign' ? Number(level) : 0, cleared: Number(cleared ?? 0),
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
    .select('user_id, rules, over, state, step, started_at, ticks_total, wave, lives, gold, kills, won, stars')
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
  // Les vagues ont duré `total` × 100 ms ; le jeu accélère ×3 au maximum (marge ×5). Le compte se
  // fait depuis le début de la partie, pas depuis l'envoi précédent : des vagues gardées pendant une
  // coupure réseau peuvent arriver l'une après l'autre.
  const total = row.ticks_total + ticks;
  if (Date.now() - Date.parse(row.started_at) < total * 20) throw new Refused('vague jouée trop vite');
  const { data: saved, error: e2 } = await db
    .from('td_sessions')
    .update({ state: s, wave: s.wave, lives: s.lives, gold: s.gold, kills: s.kills, over: s.over, won: s.won, stars: starsOf(s), last_call_at: new Date().toISOString(), last_ticks: ticks, ticks_total: total, step: row.step + 1 })
    .eq('id', session)
    .eq('step', row.step)
    .select('id');
  if (e2) throw new Error(e2.message);
  // Le filtre sur `step` agit comme une comparaison-et-échange : deux requêtes concurrentes
  // basées sur la même vague (envoi normal et envoi à la fermeture de la page) ne peuvent pas toutes
  // deux l'enregistrer. La seconde relit la ligne et reçoit le résultat de la première (le même).
  if (!saved?.length) return wave(uid, session, actions, step);
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
    if (body?.op === 'reserve') return reply(await reserve(uid));
    if (body?.op === 'start') {
      if (!(Number(body.v) >= PROTOCOL)) throw new Refused(OUTDATED);
      if (body.ticket !== undefined) return reply(await startTicket(uid, body.ticket, body.options ?? null));
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
