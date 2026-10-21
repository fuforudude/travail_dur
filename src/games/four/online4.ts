// Jeux à 4 en ligne : la partie vit sur le serveur (table public.matches4, fonction board4). Le site
// l'affiche en direct, envoie les coups du joueur, et fait remplacer par l'ordinateur un joueur
// absent depuis plus d'une minute (pour que personne ne reste bloqué).

import { serverNow } from '../../net/serverClock';
import { errorMessage, getSupabase } from '../../net/supabase';
import type { GameContext } from '../types';
import type { Seat } from './engine/types';
import { createView4, type View4State } from './view4';

interface Row4 {
  id: string;
  game: 'chess4' | 'quoridor4';
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

const IDLE_MS = 65_000; // un peu plus que le serveur (60 s), pour ne pas réclamer trop tôt

/** Appel de la fonction serveur board4 ; lève l'erreur renvoyée par le serveur. */
export async function board4<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Multijoueur non configuré');
  const { data, error } = await supabase.functions.invoke('board4', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let msg = '';
    if (ctx && typeof ctx.json === 'function') msg = ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error ?? '';
    if (!msg && ctx?.status === 404) msg = 'serveur des jeux à 4 indisponible';
    throw new Error(msg || errorMessage(error));
  }
  return data as T;
}

export function mountOnline4(ctx: GameContext, game: 'chess4' | 'quoridor4', match: string): () => void {
  let row: Row4 | null = null;
  let waiting = false;
  let note = '';
  let gone = false;
  const me = ctx.me.id;

  const state = (): View4State | null =>
    row && {
      game,
      board: row.board,
      turn: row.status === 'playing' ? row.turn : null,
      me: row.players.includes(me) ? (row.players.indexOf(me) as Seat) : null,
      seats: row.names.map((name, i) => ({ name, bot: row!.players[i] === null })),
      winner: row.winner,
      draw: row.status === 'draw',
      last: row.last_move,
      waiting,
      note,
    };
  const render = () => {
    const s = state();
    if (s && !gone) view.update(s);
  };

  const refresh = async () => {
    const supabase = await getSupabase();
    const { data } = (await supabase?.from('matches4').select('*').eq('id', match).maybeSingle()) ?? {};
    if (data && !gone) {
      row = data as Row4;
      render();
    }
  };

  const send = async (body: Record<string, unknown>) => {
    try {
      await board4({ ...body, id: match });
      note = '';
    } catch (e) {
      note = (e as Error).message;
      await refresh(); // on se recale sur le serveur
    } finally {
      waiting = false;
      render();
    }
  };

  const view = createView4(ctx.root, {
    play: (mv) => {
      if (!row || waiting) return;
      waiting = true;
      render();
      void send({ op: 'move', mv, step: row.plies });
    },
    resign: () => void send({ op: 'resign' }),
    exit: () => {
      // Quitter une partie en cours, c'est abandonner (les autres continuent avec l'ordinateur).
      const s = state();
      if (s && s.turn !== null && s.me !== null) void board4({ op: 'resign', id: match }).catch(() => {});
      ctx.onExit();
    },
  });

  // Joueur au trait absent depuis plus d'une minute : on demande au serveur de le remplacer.
  const idleTimer = window.setInterval(() => {
    if (!row || row.status !== 'playing' || row.turn === null) return;
    const who = row.players[row.turn];
    if (!who || who === me || serverNow() - Date.parse(row.updated_at) < IDLE_MS) return;
    void board4({ op: 'claim', id: match }).catch(() => {});
  }, 5000);

  let off = () => {};
  void (async () => {
    const supabase = await getSupabase();
    if (!supabase || gone) return;
    const channel = supabase
      .channel(`m4:${match}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches4', filter: `id=eq.${match}` }, (p) => {
        row = p.new as Row4;
        render();
      })
      .subscribe();
    off = () => void supabase.removeChannel(channel);
    await refresh();
  })();

  return () => {
    gone = true;
    clearInterval(idleTimer);
    off();
    view.destroy();
  };
}
