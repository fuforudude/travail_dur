import { negamax, WIN, type Side } from '../engine';
import { colorOf, inCheck, PAWN, rules, typeOf } from './logic';

const VALUE = [0, 100, 320, 330, 500, 900, 0];

/** Matériel, plus de petits bonus : pions avancés, pièces mineures centralisées. */
function evaluate(b: number[], side: Side): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const t = typeOf(p);
    const own = colorOf(p);
    const r = Math.floor(i / 8);
    const c = i % 8;
    let v = VALUE[t];
    if (t === PAWN) v += (own === 1 ? 6 - r : r - 1) * 6;
    else if (t === 2 || t === 3) v += 12 - 3 * (Math.abs(3.5 - r) + Math.abs(3.5 - c));
    score += own === side ? v : -v;
  }
  return score;
}

/** Les prises d'abord (la plus grosse pièce prise en premier) : l'alpha-bêta coupe bien plus tôt. */
function order(b: number[], _side: Side, moves: string[]): string[] {
  const gain = (mv: string) => {
    const to = (8 - Number(mv[3])) * 8 + 'abcdefgh'.indexOf(mv[2]);
    return VALUE[typeOf(b[to])] + (mv.length > 4 ? 800 : 0);
  };
  return moves.map((m) => [gain(m), m] as const).sort((x, y) => y[0] - x[0]).map(([, m]) => m);
}

export const ai = negamax(rules, {
  depth: 4,
  evaluate,
  order,
  stuck: (b, side) => (inCheck(b, side) ? -WIN : 0),
});
