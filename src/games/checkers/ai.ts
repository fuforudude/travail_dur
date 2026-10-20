import { negamax, WIN, type Side } from '../board';
import { isKing, rowOf, rules, sideOf } from './logic';

/** Pions 100, dames 320, et un bonus pour les pions qui avancent. */
function evaluate(b: number[], side: Side): number {
  let score = 0;
  for (let i = 0; i < 50; i++) {
    const p = b[i];
    if (!p) continue;
    const own = sideOf(p);
    const v = isKing(p) ? 320 : 100 + (own === 1 ? 9 - rowOf(i) : rowOf(i)) * 3;
    score += own === side ? v : -v;
  }
  return score;
}

export const ai = negamax(rules, {
  // Les dames volantes multiplient les coups possibles : on calcule moins loin dès qu'il y en a.
  depth: (b) => (b.slice(0, 50).some(isKing) ? 4 : 6),
  evaluate,
  stuck: () => -WIN,
});
