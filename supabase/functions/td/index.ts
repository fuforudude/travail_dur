// Fonction serveur du tower defense (Supabase Edge Function, Deno).
//
// Le serveur garde l'état de chaque partie et la valide : il tire la graine, vérifie le mode
// (niveau débloqué, héros possédé et son niveau, améliorations de la boutique à étoiles), puis
// rejoue chaque vague à partir des actions du joueur (avant et pendant la vague, datées au tick
// près) avec le même moteur que le jeu (./engine, copié depuis src/ par scripts/td-sync.mjs). Le
// résultat va dans td_sessions ; le déclencheur points_on_td attribue alors les points.
//
// Le site ne dépend jamais d'une réponse pour jouer (voir src/games/towerdefense/uploads.ts) :
// * `reserve` : il garde d'avance une partie réservée (« ticket » : ligne td_sessions sans état,
//   graine tirée ici) et lance la partie suivante dessus, instantanément, même hors ligne ;
// * `sync` : il envoie dans l'ordre, par lots, ce qui est en attente dans le navigateur (démarrage
//   d'une partie avec ses réglages, puis ses vagues). Tout est rejouable sans risque : un ticket déjà
//   démarré ou une vague déjà reçue (`step`) renvoient le résultat enregistré, sans rien recompter.
// Les refus sont notés dans td_rejects pour comprendre ce qui se passe chez les joueurs.
//
// Déploiement : automatique (workflow « Supabase ») ; à la main : `npm run td:sync` puis
// `npx supabase functions deploy td` (voir le README).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { HEROES } from './engine/data.ts';
import { newRun, replayWave, runError, starsOf, type RunOptions, type RunState } from './engine/sim.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Refus du serveur. `final` : inutile de renvoyer (sinon, réessayer plus tard, ex. « trop vite »). */
class Refused extends Error {
  readonly final: boolean;
  constructor(message: string, final = true) {
    super(message);
    this.final = final;
  }
}

// Version du protocole du site (TD_PROTOCOL dans src/games/towerdefense/net.ts). Un onglet resté
// ouvert sur un très vieux code ne démarre plus de partie : il est invité à recharger la page.
const PROTOCOL = 2;
const OUTDATED = 'nouvelle version du jeu : recharge la page (Ctrl+F5)';
const UUID = /^[0-9a-f-]{36}$/;
const MAX_FREE_TICKETS = 5; // tickets réservés non utilisés par joueur (plusieurs appareils, onglets)
const MAX_BATCH = 60;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

/** Compte de l'appelant. Vérification locale du jeton quand c'est possible (pas d'aller-retour). */
async function userId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const auth = db.auth as typeof db.auth & { getClaims?: (t: string) => Promise<{ data: { claims?: { sub?: string; role?: string } } | null }> };
  if (auth.getClaims) {
    const { data } = await auth.getClaims(token).catch(() => ({ data: null }));
    const claims = data?.claims;
    return claims?.role === 'authenticated' && claims.sub ? claims.sub : null;
  }
  const { data } = await db.auth.getUser(token);
  return data?.user?.id ?? null;
}

async function logReject(uid: string, session: unknown, step: unknown, error: string) {
  await db
    .from('td_rejects')
    .insert({ user_id: uid, session: typeof session === 'string' && UUID.test(session) ? session : null, step: Number.isInteger(step) ? step : null, error })
    .then(() => {}, () => {});
}

// --- Tickets ---------------------------------------------------------------------------------------

/**
 * Un ticket libre que le site n'a pas déjà (`have` : ceux qu'il garde ou qui attendent d'être
 * démarrés dans sa file), créé au besoin. Au-delà de MAX_FREE_TICKETS, les plus vieux sont repris.
 */
async function reserve(uid: string, have: unknown) {
  const held = new Set(Array.isArray(have) ? have.filter((x) => typeof x === 'string') : []);
  const { data: free, error } = await db
    .from('td_sessions')
    .select('id, seed')
    .eq('user_id', uid)
    .eq('rules', 3)
    .is('state', null)
    .order('started_at', { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  const pick = (free ?? []).find((r) => !held.has(r.id));
  if (pick) return { id: pick.id, seed: Number(pick.seed) };
  const extra = (free ?? []).length - MAX_FREE_TICKETS + 1;
  if (extra > 0) {
    const old = (free ?? []).slice(0, extra).map((r) => r.id);
    await db.from('td_sessions').delete().in('id', old).is('state', null);
  }
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const { data, error: e2 } = await db.from('td_sessions').insert({ user_id: uid, rules: 3, seed, state: null }).select('id').single();
  if (e2) throw new Error(e2.message);
  return { id: data.id, seed };
}

/**
 * Démarre une partie sur un ticket, avec les réglages utilisés par le site (progression, niveau du
 * héros, améliorations qu'il connaissait) : on les reprend s'ils ne dépassent pas ce que le joueur
 * possède vraiment, pour rejouer exactement la même partie.
 */
async function startTicket(uid: string, ticket: unknown, o: Record<string, unknown> | null): Promise<{ id: string; already?: boolean }> {
  if (typeof ticket !== 'string' || !UUID.test(ticket) || !o || typeof o !== 'object') throw new Refused('ticket inconnu');
  const { data: row, error } = await db.from('td_sessions').select('user_id, rules, seed, state, mode, level').eq('id', ticket).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.user_id !== uid || row.rules !== 3) throw new Refused('ticket inconnu');
  if (row.state) {
    // Déjà démarrée (réponse perdue, renvoi) : rien à refaire.
    if (row.mode === o.mode && (row.mode === 'infinite' || row.level === Number(o.level))) return { id: ticket, already: true };
    throw new Refused('ticket déjà utilisé');
  }
  if (o.mode !== 'campaign' && o.mode !== 'infinite') throw new Refused('mode inconnu');
  const hero = (o.hero ?? null) as { id?: unknown; level?: unknown } | null;
  if (hero !== null && (typeof hero !== 'object' || !HEROES.some((h) => h.id === hero.id) || !Number.isInteger(hero.level) || (hero.level as number) < 1)) {
    throw new Refused('héros inconnu');
  }
  const perks = (o.perks ?? {}) as Record<string, unknown>;
  if (typeof perks !== 'object' || Array.isArray(perks)) throw new Refused('amélioration inconnue');
  const [{ data: cleared, error: e1 }, { data: owned, error: e2 }, { data: perkRows, error: e3 }, { data: cleared2, error: e5 }] = await Promise.all([
    db.rpc('td_cleared', { uid }),
    hero ? db.from('td_heroes').select('level').eq('user_id', uid).eq('hero_id', hero.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('td_perks').select('perk_id, rank').eq('user_id', uid),
    db.rpc('td_cleared2', { uid }), // chapitre 2 (0040_chapitre2.sql)
  ]);
  if (e1 || e2 || e3 || e5) throw new Error((e1 ?? e2 ?? e3 ?? e5)!.message);
  if (hero && (!owned || (hero.level as number) > Number(owned.level))) throw new Refused('héros pas encore obtenu');
  const ranks = new Map((perkRows ?? []).map((r) => [String(r.perk_id), Number(r.rank)]));
  for (const [id, n] of Object.entries(perks)) {
    if (typeof n !== 'number' || n > (ranks.get(id) ?? 0)) throw new Refused('amélioration pas encore achetée');
  }
  const known = Number(o.cleared);
  if (!Number.isInteger(known) || known < 0 || known > Number(cleared ?? 0)) throw new Refused('niveau pas encore débloqué');
  // Chapitre 2 : même principe, la progression connue du site ne doit pas dépasser la vraie.
  const known2 = Number(o.cleared2 ?? 0);
  if (!Number.isInteger(known2) || known2 < 0 || known2 > Number(cleared2 ?? 0)) throw new Refused('niveau pas encore débloqué');
  const options: RunOptions = {
    mode: o.mode, level: o.mode === 'campaign' ? Number(o.level) : 0, cleared: known, cleared2: known2,
    hero: hero ? { id: hero.id as string, level: hero.level as number } : null, perks: perks as Record<string, number>,
  };
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
  return { id: ticket };
}

/** Ancien lancement en direct (sites pas encore rechargés) : graine tirée ici, partie créée aussitôt. */
async function start(uid: string, mode: unknown, level: unknown, hero: unknown) {
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
  const options: RunOptions = {
    mode, level: mode === 'campaign' ? Number(level) : 0, cleared: Number(cleared ?? 0), cleared2: Number(cleared2 ?? 0),
    hero: hero && owned ? { id: hero as string, level: Number(owned.level) } : null,
    perks: Object.fromEntries((perkRows ?? []).map((r) => [String(r.perk_id), Number(r.rank)])),
  };
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

// --- Vagues ----------------------------------------------------------------------------------------

async function wave(uid: string, session: unknown, actions: unknown, step: unknown): Promise<Record<string, unknown>> {
  if (typeof session !== 'string' || !UUID.test(session)) throw new Refused('partie inconnue');
  if (typeof actions !== 'string' || actions.length > 20000) throw new Refused('actions invalides');
  const { data: row, error } = await db
    .from('td_sessions')
    .select('user_id, rules, over, state, step, started_at, ticks_total, wave, lives, gold, kills, won, stars')
    .eq('id', session)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.user_id !== uid || row.rules !== 3) throw new Refused('partie inconnue');
  if (!row.state) throw new Refused('partie pas encore démarrée', false); // son démarrage arrive juste avant
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
  // fait depuis le début de la partie (pour un ticket : sa réservation), pas depuis l'envoi
  // précédent : des vagues gardées pendant une coupure ou envoyées par lot arrivent d'un coup.
  const total = row.ticks_total + ticks;
  if (Date.now() - Date.parse(row.started_at) < total * 20) throw new Refused('vague jouée trop vite', false);
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

// --- Lots ------------------------------------------------------------------------------------------

type Item = { kind?: string; session?: unknown; step?: unknown; actions?: unknown; options?: Record<string, unknown> | null };
type ItemResult = { ok: true; result?: Record<string, unknown> } | { ok: false; error: string; final: boolean };

/**
 * Traite dans l'ordre ce que le site avait en attente. Un refus définitif écarte la partie concernée
 * (les autres continuent) ; une panne ou un refus temporaire arrête le lot : le site renverra la suite.
 */
async function sync(uid: string, items: unknown): Promise<{ results: ItemResult[] }> {
  if (!Array.isArray(items) || items.length > MAX_BATCH) throw new Refused('lot invalide');
  const results: ItemResult[] = [];
  const refused = new Map<string, string>();
  for (const it of items as Item[]) {
    const session = String(it?.session ?? '');
    if (refused.has(session)) {
      results.push({ ok: false, error: refused.get(session)!, final: true });
      continue;
    }
    try {
      const result = it?.kind === 'start' ? await startTicket(uid, it.session, it.options ?? null) : await wave(uid, it?.session, it?.actions, it?.step);
      results.push({ ok: true, result });
    } catch (e) {
      if (e instanceof Refused && e.final) {
        await logReject(uid, it?.session, it?.step, e.message);
        refused.set(session, e.message);
        results.push({ ok: false, error: e.message, final: true });
        continue;
      }
      if (!(e instanceof Refused)) console.error(e);
      results.push({ ok: false, error: e instanceof Refused ? e.message : 'erreur du serveur', final: false });
      break;
    }
  }
  return { results };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'méthode non permise' }, 405);
  const uid = await userId(req);
  if (!uid) return reply({ error: 'non connecté' }, 401);
  const body = await req.json().catch(() => null);
  try {
    if (body?.op === 'ping') return reply({ ok: true });
    if (body?.op === 'reserve') return reply(await reserve(uid, body.have));
    if (body?.op === 'sync') {
      if (!(Number(body.v) >= PROTOCOL)) throw new Refused(OUTDATED);
      return reply(await sync(uid, body.items));
    }
    if (body?.op === 'start') {
      if (!(Number(body.v) >= PROTOCOL)) throw new Refused(OUTDATED);
      if (body.ticket !== undefined) return reply(await startTicket(uid, body.ticket, body.options ?? null));
      return reply(await start(uid, body.mode, body.level, body.hero ?? null));
    }
    if (body?.op === 'wave') {
      // Les vagues en attente d'un site un peu ancien (avec `step`) restent acceptées : rien ne se perd.
      if (body.step === undefined && !(Number(body.v) >= PROTOCOL)) throw new Refused(OUTDATED);
      try {
        return reply(await wave(uid, body.session, body.actions, body.step));
      } catch (e) {
        if (e instanceof Refused && e.final) await logReject(uid, body.session, body.step, e.message);
        throw e;
      }
    }
    return reply({ error: 'opération inconnue' }, 400);
  } catch (e) {
    if (e instanceof Refused) return reply({ error: e.message }, e.final ? 400 : 409);
    console.error(e);
    return reply({ error: 'erreur du serveur' }, 500);
  }
});
