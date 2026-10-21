// Fonction serveur des jeux à 4 joueurs (échecs à 4, corridor à 4) : Supabase Edge Function (Deno).
//
// Le serveur tient chaque partie (table public.matches4, 0039_jeux_a_4.sql) et valide chaque coup
// avec le même moteur que le site (./engine, copié depuis src/games/four/engine par
// scripts/td-sync.mjs). Les places vides sont jouées par l'ordinateur, ici même, juste après le
// coup d'un humain. Un joueur absent plus d'une minute peut être remplacé par l'ordinateur.
//
// Opérations (POST, utilisateur connecté) :
//   create { game, room, players }  : partie avec l'appelant (rouge) et jusqu'à 3 joueurs du salon
//   move   { id, mv, step }         : coup du joueur au trait ; `step` = coups déjà joués (renvoi sans risque)
//   resign { id }                   : abandon (le joueur est éliminé)
//   claim  { id }                   : le joueur au trait ne joue plus depuis 1 min : l'ordinateur le remplace
// Déploiement : automatique (workflow Supabase), ou `npm run td:sync` puis `supabase functions deploy board4`.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { aiFor } from './engine/ai4.ts';
import * as chess from './engine/chess4.ts';
import * as quoridor from './engine/quoridor4.ts';
import type { Rules4, Seat } from './engine/types.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class Refused extends Error {}

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

type Game = 'chess4' | 'quoridor4';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDLE_MS = 60_000;

const rulesOf = (g: Game): Rules4 => (g === 'chess4' ? chess.rules : quoridor.rules);
const resignOf = (g: Game) => (g === 'chess4' ? chess.resign : quoridor.resign);

interface Row {
  id: string;
  game: Game;
  players: (string | null)[];
  names: string[];
  board: number[];
  turn: Seat | null;
  status: 'playing' | 'won' | 'draw';
  winner: Seat | null;
  plies: number;
  last_move: string | null;
  updated_at: string;
}

/** Fait jouer l'ordinateur tant que c'est à une place sans humain. */
function runBots(row: Row): Row {
  const rules = rulesOf(row.game);
  const ai = aiFor(row.game);
  let r = row;
  // Jusqu'à la fin de la partie si plus aucun humain n'est en jeu (600 coups au plus aux échecs à 4).
  for (let guard = 0; guard < 700 && r.status === 'playing' && r.turn !== null && r.players[r.turn] === null; guard++) {
    r = playMove(r, r.turn, ai(r.board, r.turn), rules);
  }
  return r;
}

function playMove(row: Row, seat: Seat, mv: string, rules: Rules4): Row {
  const plies = row.plies + 1;
  const res = rules.advance(rules.apply(row.board, seat, mv), seat, plies);
  return {
    ...row,
    board: res.board,
    plies,
    last_move: mv,
    turn: res.next,
    winner: res.winner,
    status: res.winner !== null ? 'won' : res.draw ? 'draw' : 'playing',
  };
}

/** Après un abandon ou un remplacement : qui joue maintenant, et la partie est-elle finie ? */
function settle(row: Row, from: Seat): Row {
  const res = rulesOf(row.game).advance(row.board, from, row.plies);
  const turn = row.turn !== null && rulesOf(row.game).alive(res.board, row.turn) ? row.turn : res.next;
  return { ...row, board: res.board, turn: res.winner !== null || res.draw ? null : turn, winner: res.winner, status: res.winner !== null ? 'won' : res.draw ? 'draw' : 'playing' };
}

async function load(id: unknown): Promise<Row> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Refused('partie inconnue');
  const { data, error } = await db.from('matches4').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Refused('partie inconnue');
  return data as Row;
}

/** Enregistre la nouvelle version, seulement si personne ne l'a changée entre-temps. */
async function save(before: Row, after: Row): Promise<Row> {
  const { data, error } = await db
    .from('matches4')
    .update({
      players: after.players, board: after.board, turn: after.turn, status: after.status, winner: after.winner,
      plies: after.plies, last_move: after.last_move, updated_at: new Date().toISOString(),
    })
    .eq('id', before.id)
    .eq('plies', before.plies)
    .eq('updated_at', before.updated_at)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Refused('la partie a changé entre-temps : réessaie');
  return data as Row;
}

async function create(uid: string, game: unknown, room: unknown, players: unknown) {
  if (game !== 'chess4' && game !== 'quoridor4') throw new Refused('jeu inconnu');
  if (typeof room !== 'string' || !/^[A-Z]{4}$/.test(room)) throw new Refused('salon invalide');
  const others = Array.isArray(players) ? [...new Set(players.filter((p): p is string => typeof p === 'string' && UUID.test(p) && p !== uid))].slice(0, 3) : [];
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from('matches4').select('id', { count: 'exact', head: true }).eq('created_by', uid).gt('created_at', since);
  if ((count ?? 0) >= 5) throw new Refused('trop de parties lancées : réessaie dans une minute');
  const ids = [uid, ...others];
  const { data: profiles, error } = await db.from('profiles').select('id, username').in('id', ids);
  if (error) throw new Error(error.message);
  const name = new Map((profiles ?? []).map((p) => [p.id as string, p.username as string]));
  const seats: (string | null)[] = ids.filter((id) => name.has(id));
  if (!seats.includes(uid)) throw new Refused('compte inconnu');
  let bots = 0;
  while (seats.length < 4) seats.push(null);
  const names = seats.map((id) => (id ? name.get(id)! : `Ordinateur ${++bots}`));
  const { data, error: e2 } = await db
    .from('matches4')
    .insert({ game, room, players: seats, names, board: rulesOf(game).initial(), turn: 0, created_by: uid })
    .select('id')
    .single();
  if (e2) throw new Error(e2.message);
  return { id: data.id };
}

async function move(uid: string, id: unknown, mv: unknown, step: unknown) {
  const row = await load(id);
  if (!row.players.includes(uid)) throw new Refused('tu ne joues pas cette partie');
  if (Number.isInteger(step) && (step as number) < row.plies) return { already: true }; // déjà reçu
  if (row.status !== 'playing' || row.turn === null) throw new Refused('partie terminée');
  if (row.players[row.turn] !== uid) throw new Refused('ce n’est pas ton tour');
  if (Number.isInteger(step) && step !== row.plies) throw new Refused('coup en retard : la partie a avancé');
  const rules = rulesOf(row.game);
  if (typeof mv !== 'string' || !rules.isLegal(row.board, row.turn, mv)) throw new Refused('coup impossible');
  await save(row, runBots(playMove(row, row.turn, mv, rules)));
  return { ok: true };
}

async function resign(uid: string, id: unknown) {
  const row = await load(id);
  const seat = row.players.indexOf(uid) as Seat;
  if (seat < 0) throw new Refused('tu ne joues pas cette partie');
  if (row.status !== 'playing' || !rulesOf(row.game).alive(row.board, seat)) return { ok: true };
  const out = settle({ ...row, board: resignOf(row.game)(row.board, seat) }, seat);
  await save(row, runBots(out));
  return { ok: true };
}

async function claim(uid: string, id: unknown) {
  const row = await load(id);
  if (!row.players.includes(uid)) throw new Refused('tu ne joues pas cette partie');
  if (row.status !== 'playing' || row.turn === null || row.players[row.turn] === null) return { ok: true };
  if (Date.now() - Date.parse(row.updated_at) < IDLE_MS) throw new Refused('il a encore un peu de temps pour jouer');
  const players = row.players.slice();
  players[row.turn] = null; // l'ordinateur prend sa place
  await save(row, runBots({ ...row, players }));
  return { ok: true };
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
    if (body?.op === 'create') return reply(await create(uid, body.game, body.room, body.players));
    if (body?.op === 'move') return reply(await move(uid, body.id, body.mv, body.step));
    if (body?.op === 'resign') return reply(await resign(uid, body.id));
    if (body?.op === 'claim') return reply(await claim(uid, body.id));
    return reply({ error: 'opération inconnue' }, 400);
  } catch (e) {
    if (e instanceof Refused) return reply({ error: e.message }, 400);
    console.error(e);
    return reply({ error: 'erreur du serveur' }, 500);
  }
});
