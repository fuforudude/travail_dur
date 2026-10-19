import { isPanicked, onPanicChange } from '../../core/panic';
import { blip } from '../../core/sound';
import type { ViewState } from '../duel';
import { mountOnline } from '../online';
import type { Game, GameContext } from '../types';
import { aiMove, findLine, isFull } from './logic';
import { createView } from './view';

/** Partie solo contre l'ordinateur, entièrement locale (non classée). */
function mountSolo(ctx: GameContext): () => void {
  const empty = () => new Array(9).fill(0);
  let s: ViewState = {
    board: empty(),
    names: [ctx.me.name, 'Ordinateur'],
    me: 0,
    turn: 0,
    result: null,
    line: [],
    last: null,
    scores: [0, 0],
  };
  let starter: 0 | 1 = 0;
  let aiTimer: number | undefined;

  const apply = (cell: number) => {
    if (s.result !== null || s.board[cell] !== 0) return;
    const board = s.board.slice();
    board[cell] = s.turn + 1;
    const win = findLine(board);
    s = { ...s, board, last: cell, turn: (1 - s.turn) as 0 | 1 };
    if (win) {
      s.result = (win.who - 1) as 0 | 1;
      s.line = win.line;
      s.scores = s.scores.slice() as [number, number];
      s.scores[s.result]++;
    } else if (isFull(board)) s.result = 'draw';
    blip(300);
    view.update(s);
    scheduleAi();
  };

  const scheduleAi = () => {
    if (s.result !== null || s.turn !== 1 || aiTimer) return;
    aiTimer = window.setTimeout(() => {
      aiTimer = undefined;
      if (isPanicked()) return; // reprise à la sortie du faux écran
      apply(aiMove(s.board, 2));
    }, 400);
  };

  const view = createView(ctx.root, {
    play: (cell) => s.turn === 0 && apply(cell),
    rematch: () => {
      if (s.result === null) return;
      starter = (1 - starter) as 0 | 1;
      s = { ...s, board: empty(), turn: starter, result: null, line: [], last: null };
      view.update(s);
      scheduleAi();
    },
    exit: () => ctx.onExit(),
  });
  const offPanic = onPanicChange((paused) => !paused && scheduleAi());
  view.update(s);

  return () => {
    clearTimeout(aiTimer);
    offPanic();
    view.destroy();
  };
}

export const tictactoe: Game = {
  id: 'tictactoe',
  name: 'Morpion',
  description: 'Solo contre l’ordinateur ou à deux en salon',
  modes: ['solo', 'multi'],
  minPlayers: 2,
  maxPlayers: 2,
  mount: (ctx) => (ctx.mode === 'multi' ? mountOnline(ctx, createView) : mountSolo(ctx)),
};
