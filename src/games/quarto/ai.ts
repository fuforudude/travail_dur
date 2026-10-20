import { negamax, type Ai } from '../engine';
import { moves, rules, winningLine } from './logic';

const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/** L'adversaire peut-il gagner tout de suite en posant la pièce `piece` ? */
function givesWin(b: number[], piece: number): boolean {
  for (let cell = 0; cell < 16; cell++) {
    if (b[cell]) continue;
    const n = b.slice();
    n[cell] = piece + 1;
    if (winningLine(n)) return true;
  }
  return false;
}

// Fin de partie : peu de cases libres, on peut tout calculer.
const endgame = negamax(rules, {
  depth: 4,
  evaluate: () => 0,
  over: (b, mover) => (winningLine(b) ? { winner: mover } : null),
  stuck: () => 0,
});

/** Gagne si possible, sinon ne donne jamais une pièce gagnante (quand on peut l'éviter). */
export const ai: Ai = (b, side, history) => {
  const all = moves(b);
  const empty = b.slice(0, 16).filter((v) => v === 0).length;
  if (b[16] && empty <= 8) return endgame(b, side, history);
  const win = all.find((mv) => !mv.includes('g') && winningLine(rules.apply(b, side, mv)));
  if (win) return win;
  const safe = all.filter((mv) => {
    const n = rules.apply(b, side, mv);
    return !n[16] || !givesWin(n, n[16] - 1);
  });
  return pick(safe.length ? safe : all);
};
