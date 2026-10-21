// Jeux à 4 en solo : le joueur (rouge, en bas) contre trois ordinateurs, entièrement dans le navigateur.

import { isPanicked, onPanicChange } from '../../core/panic';
import { soloReward } from '../solo';
import type { GameContext } from '../types';
import { aiFor } from './engine/ai4';
import * as chess from './engine/chess4';
import * as quoridor from './engine/quoridor4';
import type { Rules4, Seat } from './engine/types';
import { createView4, type View4State } from './view4';

export function mountSolo4(ctx: GameContext, game: 'chess4' | 'quoridor4'): () => void {
  const rules: Rules4 = game === 'chess4' ? chess.rules : quoridor.rules;
  const resign = game === 'chess4' ? chess.resign : quoridor.resign;
  const ai = aiFor(game);
  const seats = [{ name: ctx.me.name, bot: false }, { name: 'Ordinateur 1', bot: true }, { name: 'Ordinateur 2', bot: true }, { name: 'Ordinateur 3', bot: true }];
  let s: View4State;
  let plies = 0;
  let timer: number | undefined;
  let rewarded = false;

  const reset = () => {
    clearTimeout(timer);
    plies = 0;
    rewarded = false;
    s = { game, board: rules.initial(), turn: 0, me: 0, seats, winner: null, draw: false, last: null };
  };

  const play = (seat: Seat, mv: string) => {
    if (s.turn !== seat || !rules.isLegal(s.board, seat, mv)) return;
    plies++;
    const r = rules.advance(rules.apply(s.board, seat, mv), seat, plies);
    s = { ...s, board: r.board, turn: r.next, winner: r.winner, draw: r.draw, last: mv };
    finish();
    view.update(s);
    schedule();
  };

  const finish = () => {
    if (s.turn !== null || rewarded) return;
    rewarded = true;
    soloReward(game, s.winner === 0, plies);
  };

  /** Tour d'un ordinateur (ou du joueur éliminé, qu'on saute) : on joue après un petit délai. */
  const schedule = () => {
    clearTimeout(timer);
    if (s.turn === null || s.turn === 0) return;
    const seat = s.turn;
    timer = window.setTimeout(() => {
      if (isPanicked()) return; // reprise à la sortie du faux écran
      play(seat, ai(s.board, seat));
    }, game === 'chess4' ? 450 : 600);
  };

  const view = createView4(ctx.root, {
    play: (mv) => play(0, mv),
    resign: () => {
      // Abandon : le joueur est éliminé, les ordinateurs finissent la partie entre eux en accéléré.
      const board = resign(s.board, 0);
      const r = rules.advance(board, 0, plies);
      s = { ...s, board: r.board, turn: r.next, winner: r.winner, draw: r.draw };
      finish();
      view.update(s);
      schedule();
    },
    rematch: () => {
      reset();
      view.update(s);
    },
    exit: () => ctx.onExit(),
  });
  const offPanic = onPanicChange((paused) => !paused && schedule());
  reset();
  view.update(s!);

  return () => {
    clearTimeout(timer);
    offPanic();
    view.destroy();
  };
}
