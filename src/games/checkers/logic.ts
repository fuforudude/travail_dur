// Jeu de dames international (10×10). Doit rester identique à public.dames_* (supabase/migrations/0006_plateaux.sql).
//
// État : 51 nombres.
//   0..49  les 50 cases foncées, ligne par ligne depuis le haut (case n° i + 1 dans la notation officielle).
//          0 vide, 1 pion blanc, 2 dame blanche, 3 pion noir, 4 dame noire.
//   50     demi-coups consécutifs de dames sans prise (nulle à 50, soit 25 coups chacun)
// Camp 1 = blancs (en bas, ils commencent), camp 2 = noirs.
// Coups : « 31-27 » pour un déplacement, « 27x18x9 » pour une rafle (cases d'arrivée successives).

import type { Outcome, Rules, Side } from '../board';

export const rowOf = (i: number) => Math.floor(i / 5);
export const colOf = (i: number) => {
  const r = rowOf(i);
  return 2 * (i % 5) + (r % 2 === 0 ? 1 : 0);
};
/** Index de la case (ligne, colonne), ou -1 si hors plateau ou case claire. */
export const indexAt = (r: number, c: number) => (r < 0 || r > 9 || c < 0 || c > 9 || (r + c) % 2 === 0 ? -1 : r * 5 + (c >> 1));

export const sideOf = (p: number): 0 | Side => (p === 0 ? 0 : p <= 2 ? 1 : 2);
export const isKing = (p: number) => p === 2 || p === 4;

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export function initial(): number[] {
  const b = new Array(51).fill(0);
  for (let i = 0; i < 20; i++) b[i] = 3;
  for (let i = 30; i < 50; i++) b[i] = 1;
  return b;
}

/**
 * Rafles depuis `from`. `b` est le plateau sans la pièce qui joue ; `taken` les pièces déjà sautées
 * (elles restent sur le plateau jusqu'à la fin du coup et ne peuvent être sautées deux fois).
 */
function captures(b: number[], side: Side, king: boolean, from: number, taken: number[], path: string, out: { path: string; n: number }[]) {
  let extended = false;
  const r0 = rowOf(from);
  const c0 = colOf(from);
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    if (king) {
      while (indexAt(r, c) >= 0 && b[indexAt(r, c)] === 0) {
        r += dr;
        c += dc;
      }
    }
    const over = indexAt(r, c);
    if (over < 0 || sideOf(b[over]) !== 3 - side || taken.includes(over)) continue;
    r += dr;
    c += dc;
    while (indexAt(r, c) >= 0 && b[indexAt(r, c)] === 0) {
      const land = indexAt(r, c);
      extended = true;
      captures(b, side, king, land, [...taken, over], `${path}x${land}`, out);
      if (!king) break;
      r += dr;
      c += dc;
    }
  }
  if (!extended && taken.length) out.push({ path, n: taken.length });
}

export function moves(b: number[], side: Side): string[] {
  const caps: { path: string; n: number }[] = [];
  const quiet: string[] = [];
  for (let i = 0; i < 50; i++) {
    const p = b[i];
    if (sideOf(p) !== side) continue;
    const lifted = b.slice();
    lifted[i] = 0;
    captures(lifted, side, isKing(p), i, [], String(i), caps);
    for (const [dr, dc] of DIRS) {
      if (!isKing(p) && dr !== (side === 1 ? -1 : 1)) continue;
      let r = rowOf(i) + dr;
      let c = colOf(i) + dc;
      while (indexAt(r, c) >= 0 && b[indexAt(r, c)] === 0) {
        quiet.push(`${i}-${indexAt(r, c)}`);
        if (!isKing(p)) break;
        r += dr;
        c += dc;
      }
    }
  }
  if (!caps.length) return quiet;
  // Prise obligatoire, et du plus grand nombre de pièces.
  const max = Math.max(...caps.map((x) => x.n));
  return [...new Set(caps.filter((x) => x.n === max).map((x) => x.path))];
}

export function isLegal(b: number[], side: Side, mv: string): boolean {
  return moves(b, side).includes(mv);
}

export function apply(b: number[], side: Side, mv: string): number[] {
  const n = b.slice();
  const capture = mv.includes('x');
  const squares = mv.split(capture ? 'x' : '-').map(Number);
  const from = squares[0];
  const to = squares[squares.length - 1];
  const p = n[from];
  if (capture) {
    // La pièce prise entre deux arrêts est la seule pièce sur la diagonale qui les relie.
    for (let k = 0; k + 1 < squares.length; k++) {
      const a = squares[k];
      const z = squares[k + 1];
      const dr = Math.sign(rowOf(z) - rowOf(a));
      const dc = Math.sign(colOf(z) - colOf(a));
      for (let r = rowOf(a) + dr, c = colOf(a) + dc; r !== rowOf(z); r += dr, c += dc) {
        const i = indexAt(r, c);
        if (i !== from && n[i] !== 0) n[i] = 0;
      }
    }
  }
  n[from] = 0;
  const last = side === 1 ? 0 : 9;
  n[to] = !isKing(p) && rowOf(to) === last ? p + 1 : p;
  n[50] = isKing(p) && !capture ? b[50] + 1 : 0;
  return n;
}

export function outcome(b: number[], next: Side): Outcome | null {
  if (!moves(b, next).length) return { winner: (3 - next) as Side };
  if (b[50] >= 50) return { winner: null };
  return null;
}

export const rules: Rules = { initial, moves, isLegal, apply, outcome };
