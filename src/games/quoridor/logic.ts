// Quoridor (« corridor »). Doit rester identique à public.quoridor_* (supabase/migrations/0006_plateaux.sql).
//
// État : 68 nombres.
//   0, 1   case du pion de chaque camp (0..80, ligne * 9 + colonne, ligne 0 en haut)
//   2, 3   murs restants de chaque camp (10 au départ)
//   4..67  intersections 8×8 : 0 libre, 1 mur horizontal, 2 mur vertical.
//          L'intersection (r, c) est le coin entre les cases (r, c), (r, c+1), (r+1, c) et (r+1, c+1) ;
//          un mur y mesure deux cases et sépare les lignes r et r+1 (horizontal) ou les colonnes c et c+1 (vertical).
// Camp 1 part d'en bas et doit atteindre la ligne 0 ; camp 2 part d'en haut et vise la ligne 8.
// Coups : « m40 » pour aller en case 40, « h34 » / « v34 » pour un mur à l'intersection (3, 4).

import type { Outcome, Rules, Side } from '../board';

export const N = 9;
export const WALLS = 10;
/** Au-delà, la partie est déclarée nulle (pour qu'elle ne puisse pas durer indéfiniment). */
export const MAX_PLIES = 400;

export function initial(): number[] {
  const b = new Array(68).fill(0);
  b[0] = 8 * N + 4;
  b[1] = 4;
  b[2] = WALLS;
  b[3] = WALLS;
  return b;
}

export const wallAt = (b: number[], r: number, c: number) => (r < 0 || r > 7 || c < 0 || c > 7 ? 0 : b[4 + r * 8 + c]);
export const goalRow = (side: Side) => (side === 1 ? 0 : N - 1);

const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** Un mur sépare-t-il la case (r, c) de sa voisine dans la direction (dr, dc) ? */
export function blocked(b: number[], r: number, c: number, dr: number, dc: number): boolean {
  if (dr === 1) return wallAt(b, r, c) === 1 || wallAt(b, r, c - 1) === 1;
  if (dr === -1) return wallAt(b, r - 1, c) === 1 || wallAt(b, r - 1, c - 1) === 1;
  if (dc === 1) return wallAt(b, r, c) === 2 || wallAt(b, r - 1, c) === 2;
  return wallAt(b, r, c - 1) === 2 || wallAt(b, r - 1, c - 1) === 2;
}

const inside = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;

/** Longueur du plus court chemin du pion de `side` vers son but (en ignorant les pions), ou -1. */
export function distance(b: number[], side: Side): number {
  const goal = goalRow(side);
  const dist = new Array(N * N).fill(-1);
  const start = b[side - 1];
  dist[start] = 0;
  const queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const cell = queue[k];
    const r = Math.floor(cell / N);
    const c = cell % N;
    if (r === goal) return dist[cell];
    for (const [dr, dc] of STEPS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc) || blocked(b, r, c, dr, dc) || dist[nr * N + nc] >= 0) continue;
      dist[nr * N + nc] = dist[cell] + 1;
      queue.push(nr * N + nc);
    }
  }
  return -1;
}

/** Déplacements du pion, sauts par-dessus l'adversaire compris. */
export function pawnMoves(b: number[], side: Side): number[] {
  const me = b[side - 1];
  const opp = b[2 - side];
  const r = Math.floor(me / N);
  const c = me % N;
  const out: number[] = [];
  for (const [dr, dc] of STEPS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inside(nr, nc) || blocked(b, r, c, dr, dc)) continue;
    if (nr * N + nc !== opp) {
      out.push(nr * N + nc);
      continue;
    }
    // Adversaire collé : saut droit si possible, sinon saut en diagonale de part et d'autre.
    if (inside(nr + dr, nc + dc) && !blocked(b, nr, nc, dr, dc)) {
      out.push((nr + dr) * N + nc + dc);
      continue;
    }
    for (const [sr, sc] of dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]]) {
      if (inside(nr + sr, nc + sc) && !blocked(b, nr, nc, sr, sc)) out.push((nr + sr) * N + nc + sc);
    }
  }
  return out;
}

/** Le mur (r, c, orientation 1 = horizontal, 2 = vertical) peut-il être posé, sans tenir compte des chemins ? */
export function wallFits(b: number[], r: number, c: number, o: 1 | 2): boolean {
  if (r < 0 || r > 7 || c < 0 || c > 7 || wallAt(b, r, c) !== 0) return false;
  if (o === 1) return wallAt(b, r, c - 1) !== 1 && wallAt(b, r, c + 1) !== 1;
  return wallAt(b, r - 1, c) !== 2 && wallAt(b, r + 1, c) !== 2;
}

function withWall(b: number[], r: number, c: number, o: 1 | 2): number[] {
  const n = b.slice();
  n[4 + r * 8 + c] = o;
  return n;
}

export function wallLegal(b: number[], side: Side, r: number, c: number, o: 1 | 2): boolean {
  if (b[1 + side] <= 0 || !wallFits(b, r, c, o)) return false;
  const n = withWall(b, r, c, o);
  return distance(n, 1) >= 0 && distance(n, 2) >= 0;
}

/** Découpe un coup ; null si la syntaxe est invalide. */
export function parse(mv: string): { kind: 'm'; cell: number } | { kind: 'w'; r: number; c: number; o: 1 | 2 } | null {
  let m = /^m([0-9]|[1-7][0-9]|80)$/.exec(mv);
  if (m) return { kind: 'm', cell: Number(m[1]) };
  m = /^([hv])([0-7])([0-7])$/.exec(mv);
  if (m) return { kind: 'w', r: Number(m[2]), c: Number(m[3]), o: m[1] === 'h' ? 1 : 2 };
  return null;
}

export function isLegal(b: number[], side: Side, mv: string): boolean {
  const p = parse(mv);
  if (!p) return false;
  if (p.kind === 'm') return pawnMoves(b, side).includes(p.cell);
  return wallLegal(b, side, p.r, p.c, p.o);
}

export function moves(b: number[], side: Side): string[] {
  const out = pawnMoves(b, side).map((c) => `m${c}`);
  if (b[1 + side] > 0) {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        for (const o of [1, 2] as const) if (wallLegal(b, side, r, c, o)) out.push(`${o === 1 ? 'h' : 'v'}${r}${c}`);
  }
  return out;
}

export function apply(b: number[], side: Side, mv: string): number[] {
  const p = parse(mv)!;
  if (p.kind === 'm') {
    const n = b.slice();
    n[side - 1] = p.cell;
    return n;
  }
  const n = withWall(b, p.r, p.c, p.o);
  n[1 + side] -= 1;
  return n;
}

export function outcome(b: number[], next: Side, history: string[]): Outcome | null {
  for (const side of [1, 2] as const) if (Math.floor(b[side - 1] / N) === goalRow(side)) return { winner: side };
  if (history.length >= MAX_PLIES) return { winner: null };
  // Pion coincé sans mur à poser (très rare) : personne ne peut gagner.
  if (!pawnMoves(b, next).length && b[1 + next] === 0) return { winner: null };
  return null;
}

export const rules: Rules = { initial, moves, isLegal, apply, outcome };
