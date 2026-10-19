import { isPanicked, onPanicChange } from '../../core/panic';
import { blip } from '../../core/sound';
import type { Game, GameContext } from '../types';
import { aiMove, drop, emptyBoard, findWin, isFull, type Board } from './logic';
import type { ViewState } from '../duel';
import { mountOnline } from '../online';
import { createView } from './view';

/** Partie solo contre l'ordinateur, entièrement locale (non classée). */
function mountSolo(ctx: GameContext): () => void {
  let s: ViewState = {
    board: emptyBoard(),
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

  const apply = (col: number) => {
    if (s.result !== null) return;
    const r = drop(s.board as Board, col, (s.turn + 1) as 1 | 2);
    if (!r) return;
    const win = findWin(r.board);
    s = { ...s, board: r.board, last: r.index, turn: (1 - s.turn) as 0 | 1 };
    if (win) {
      s.result = (win.who - 1) as 0 | 1;
      s.line = win.line;
      s.scores = s.scores.slice() as [number, number];
      s.scores[s.result]++;
    } else if (isFull(r.board)) s.result = 'draw';
    blip(260);
    view.update(s);
    scheduleAi();
  };

  const scheduleAi = () => {
    if (s.result !== null || s.turn !== 1 || aiTimer) return;
    aiTimer = window.setTimeout(() => {
      aiTimer = undefined;
      if (isPanicked()) return; // reprise à la sortie du faux écran
      apply(aiMove(s.board as Board, 2));
    }, 450);
  };

  const view = createView(ctx.root, {
    play: (col) => s.turn === 0 && apply(col),
    rematch: () => {
      if (s.result === null) return;
      starter = (1 - starter) as 0 | 1;
      s = { ...s, board: emptyBoard(), turn: starter, result: null, line: [], last: null };
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

export const connect4: Game = {
  id: 'connect4',
  name: 'Puissance 4',
  description: 'Solo contre l’ordinateur ou à deux en salon',
  modes: ['solo', 'multi'],
  minPlayers: 2,
  maxPlayers: 2,
  mount: (ctx) => (ctx.mode === 'multi' ? mountOnline(ctx, createView) : mountSolo(ctx)),
};
