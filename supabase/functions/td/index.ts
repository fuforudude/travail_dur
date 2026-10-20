// Fonction serveur du tower defense (Supabase Edge Function, Deno).
//
// Le serveur garde l'état de chaque partie. Au lancement, il vérifie le deck (tours possédées,
// nombre d'emplacements) et tire la graine. À la fin de chaque vague, il reçoit les actions du
// joueur (avant et pendant la vague, datées au tick près), rejoue la vague avec le même moteur
// que le jeu (./engine, copié depuis src/ par scripts/td-sync.mjs) et enregistre le résultat
// dans td_sessions ; le déclencheur points_on_td attribue alors les points.
//
// Déploiement : `npm run td:sync` puis `npx supabase functions deploy td` (voir le README).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { deckError, newRun, replayWave, type RunState } from './engine/sim.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class Refused extends Error {}

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function start(uid: string, deck: unknown) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from('td_sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid).gt('started_at', since);
  if ((count ?? 0) >= 10) throw new Refused('trop de parties, réessaie dans une minute');
  const [{ data: items, error: e1 }, { data: best, error: e2 }] = await Promise.all([
    db.from('td_items').select('item_id').eq('user_id', uid),
    db.from('td_sessions').select('wave').eq('user_id', uid).eq('rules', 2).order('wave', { ascending: false }).limit(1),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  const owned = (items ?? []).map((r) => String(r.item_id));
  const bestWave = Number(best?.[0]?.wave ?? 0);
  if (!Array.isArray(deck) || !deck.every((d) => typeof d === 'string')) throw new Refused('deck invalide');
  const err = deckError(deck, owned, bestWave);
  if (err) throw new Refused(err);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const state = newRun(seed, deck, owned);
  const { data, error } = await db
    .from('td_sessions')
    .insert({ user_id: uid, rules: 2, seed, deck, state, wave: 0, lives: state.lives, gold: state.gold, kills: 0 })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id, state };
}

async function wave(uid: string, session: unknown, actions: unknown) {
  if (typeof session !== 'string' || !/^[0-9a-f-]{36}$/.test(session)) throw new Refused('partie inconnue');
  if (typeof actions !== 'string' || actions.length > 20000) throw new Refused('actions invalides');
  const { data: row, error } = await db.from('td_sessions').select('user_id, rules, over, state, step, last_call_at').eq('id', session).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row || row.user_id !== uid || row.rules !== 2 || !row.state) throw new Refused('partie inconnue');
  if (row.over) throw new Refused('partie terminée');
  const s = row.state as RunState;
  let ticks: number;
  try {
    ticks = replayWave(s, actions);
  } catch (e) {
    throw new Refused((e as Error).message);
  }
  // La vague a duré `ticks` × 100 ms ; le jeu accélère ×3 au maximum (marge ×5 pour le réseau).
  if (Date.now() - Date.parse(row.last_call_at) < ticks * 20) throw new Refused('vague jouée trop vite');
  const { data: saved, error: e2 } = await db
    .from('td_sessions')
    .update({ state: s, wave: s.wave, lives: s.lives, gold: s.gold, kills: s.kills, over: s.over, last_call_at: new Date().toISOString(), last_ticks: ticks, step: row.step + 1 })
    .eq('id', session)
    .eq('step', row.step)
    .select('id');
  if (e2) throw new Error(e2.message);
  if (!saved?.length) throw new Refused('vague déjà envoyée');
  return { wave: s.wave, lives: s.lives, gold: s.gold, kills: s.kills, over: s.over, ticks };
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
    if (body?.op === 'start') return reply(await start(uid, body.deck));
    if (body?.op === 'wave') return reply(await wave(uid, body.session, body.actions));
    return reply({ error: 'opération inconnue' }, 400);
  } catch (e) {
    if (e instanceof Refused) return reply({ error: e.message }, 400);
    console.error(e);
    return reply({ error: 'erreur du serveur' }, 500);
  }
});
