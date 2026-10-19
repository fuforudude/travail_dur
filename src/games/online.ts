import type { RealtimeChannel } from '@supabase/supabase-js';
import { blip } from '../core/sound';
import { errorMessage, getSupabase } from '../net/supabase';
import type { CreateView, ViewState } from './duel';
import type { GameContext } from './types';

/** Jeux à deux arbitrés par le serveur (colonne `game` de public.matches). */
export type DuelGame = 'connect4' | 'tictactoe';

/** Ligne de public.matches telle que renvoyée par Supabase. */
export interface MatchRow {
  id: string;
  room: string;
  game: DuelGame;
  p1: string;
  p2: string;
  status: 'pending' | 'declined' | 'expired' | 'playing' | 'won' | 'draw' | 'forfeit' | 'timeout';
  board: number[];
  turn: 1 | 2;
  winner: 1 | 2 | null;
  line: number[] | null;
  last_cell: number | null;
  moves: number;
  rematch_p1: boolean;
  rematch_p2: boolean;
  next_match: string | null;
  created_at: string;
  updated_at: string;
}

const FINISHED = ['won', 'draw', 'forfeit', 'timeout'];
const TIMEOUT_MS = 45_000;

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Multijoueur non configuré');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errorMessage(error));
  return data as T;
}

export const challenge = (opponent: string, room: string, game: DuelGame) =>
  rpc<string>('match_challenge', { opponent, room_code: room, game_id: game });
/** Retourne le nouvel état du défi : 'playing', 'declined' ou 'expired'. */
export const respond = (matchId: string, accept: boolean) => rpc<string>('match_respond', { match_id: matchId, accept });
export const cancelChallenge = (matchId: string) => rpc('match_forfeit', { match_id: matchId });

/** Défis et parties qui me concernent, en direct. */
export async function watchMyMatches(me: string, cb: (row: MatchRow) => void): Promise<() => void> {
  const supabase = await getSupabase();
  if (!supabase) return () => {};
  const channel = supabase.channel(`matches:${me}`);
  for (const col of ['p1', 'p2']) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'matches', filter: `${col}=eq.${me}` },
      (payload) => payload.new && 'id' in payload.new && cb(payload.new as MatchRow),
    );
  }
  channel.subscribe();
  return () => void supabase.removeChannel(channel);
}

export async function pendingChallenges(me: string, room: string): Promise<MatchRow[]> {
  const supabase = await getSupabase();
  const { data } =
    (await supabase
      ?.from('matches')
      .select('*')
      .eq('status', 'pending')
      .eq('room', room)
      .or(`p1.eq.${me},p2.eq.${me}`)
      .order('created_at', { ascending: false })
      .limit(10)) ?? {};
  return (data as MatchRow[] | null) ?? [];
}

/**
 * Partie en ligne : le serveur fait foi. On affiche la ligne de la base, on envoie les coups
 * par RPC, et on reçoit chaque mise à jour par Realtime.
 */
export function mountOnline(ctx: GameContext, createView: CreateView): () => void {
  const me = ctx.me.id;
  let matchId = ctx.match!;
  let row: MatchRow | null = null;
  let channel: RealtimeChannel | null = null;
  let lastChange = Date.now();
  let busy = false;
  let error = '';
  let confirmQuit = false;
  let disposed = false;
  const tally = new Map<string, number>(); // victoires cumulées sur les revanches
  const counted = new Set<string>();

  const view = createView(
    ctx.root,
    {
      play: (cell) => send('match_play', { match_id: matchId, cell }),
      rematch: () => {
        if (row && FINISHED.includes(row.status)) send('match_rematch', { match_id: matchId });
      },
      exit: () => {
        if (!row || row.status !== 'playing') return ctx.onExit();
        if (!confirmQuit) {
          confirmQuit = true;
          error = 'Retour arrière encore une fois pour abandonner la partie.';
          return render();
        }
        void rpc('match_forfeit', { match_id: matchId }).finally(() => ctx.onExit());
      },
      key: (key) => {
        if (key !== 'v' || !canClaim()) return false;
        send('match_claim_timeout', { match_id: matchId });
        return true;
      },
    },
    [['V', 'réclamer si absent']],
  );

  const nameOf = (id: string) => ctx.room?.nameOf(id) ?? 'Adversaire';
  const mySide = (): 0 | 1 | null => (row ? (row.p1 === me ? 0 : row.p2 === me ? 1 : null) : null);
  const opponentId = () => (row ? (row.p1 === me ? row.p2 : row.p1) : '');

  const canClaim = () =>
    row !== null && row.status === 'playing' && mySide() !== null && row.turn - 1 !== mySide() && Date.now() - lastChange > TIMEOUT_MS;

  async function send(fn: string, args: Record<string, unknown>) {
    if (busy) return;
    busy = true;
    error = '';
    confirmQuit = false;
    try {
      const next = await rpc<string | null>(fn, args);
      if (fn === 'match_rematch' && next) await switchTo(next);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
      render();
    }
  }

  const apply = (next: MatchRow) => {
    if (next.id !== matchId) return;
    if (row && Date.parse(next.updated_at) < Date.parse(row.updated_at)) return; // mise à jour en retard
    if (row && next.last_cell !== row.last_cell) blip(260);
    row = next;
    lastChange = Date.now();
    if (FINISHED.includes(row.status) && !counted.has(row.id)) {
      counted.add(row.id);
      if (row.winner) {
        const w = row.winner === 1 ? row.p1 : row.p2;
        tally.set(w, (tally.get(w) ?? 0) + 1);
      }
    }
    render();
    if (row.next_match) void switchTo(row.next_match);
  };

  const render = () => {
    if (!row) return;
    const r = row;
    const side = mySide();
    const opp = nameOf(opponentId());
    let message = error || undefined;
    if (!message) {
      if (r.status === 'forfeit') message = r.winner === (side ?? -1) + 1 ? `${opp} a abandonné. R pour une revanche.` : 'Tu as abandonné.';
      else if (r.status === 'timeout') message = r.winner === (side ?? -1) + 1 ? 'Victoire : ton adversaire ne jouait plus.' : 'Défaite au temps.';
      else if (FINISHED.includes(r.status) && (side === 0 ? r.rematch_p1 : r.rematch_p2)) message = 'Revanche demandée, en attente de l’adversaire…';
      else if (FINISHED.includes(r.status) && (side === 0 ? r.rematch_p2 : r.rematch_p1)) message = `${opp} veut une revanche : R pour accepter.`;
      else if (r.status === 'playing' && canClaim()) message = `${opp} ne joue plus : V pour réclamer la victoire.`;
      else if (r.status === 'playing' && ctx.room && !ctx.room.player(opponentId())) message = `${opp} a quitté le salon…`;
    }
    const names: [string, string] = [r.p1 === me ? ctx.me.name : nameOf(r.p1), r.p2 === me ? ctx.me.name : nameOf(r.p2)];
    const state: ViewState = {
      board: r.board.map((v) => (v === 1 || v === 2 ? v : 0)),
      names,
      me: side,
      turn: (r.turn - 1) as 0 | 1,
      result: r.status === 'draw' ? 'draw' : FINISHED.includes(r.status) && r.winner ? ((r.winner - 1) as 0 | 1) : null,
      line: r.line ?? [],
      last: r.last_cell,
      scores: [tally.get(r.p1) ?? 0, tally.get(r.p2) ?? 0],
      message,
    };
    view.update(state);
  };

  async function switchTo(id: string) {
    if (disposed || (id === matchId && channel)) return;
    const supabase = await getSupabase();
    if (!supabase) return;
    if (channel) void supabase.removeChannel(channel);
    matchId = id;
    row = null;
    error = '';
    // S'abonner d'abord, puis lire : aucune mise à jour ne peut se perdre entre les deux.
    channel = supabase
      .channel(`match:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${id}` }, (p) =>
        apply(p.new as MatchRow),
      )
      .subscribe();
    const { data, error: err } = await supabase.from('matches').select('*').eq('id', id).single();
    if (err) error = errorMessage(err);
    else apply(data as MatchRow);
    render();
  }

  const ticker = window.setInterval(render, 1000); // pour l'affichage « ne joue plus »
  const offPlayers = ctx.room?.onPlayers(render);
  void switchTo(matchId);

  return () => {
    disposed = true;
    clearInterval(ticker);
    offPlayers?.();
    view.destroy();
    void getSupabase().then((s) => channel && s?.removeChannel(channel));
  };
}
