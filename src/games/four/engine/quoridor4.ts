// Corridor à 4 : course à la case centrale. Chacun son tour, on avance son pion d'une case (sauts par-dessus
// les pions comme au corridor à 2) ou on pose une barricade de sa couleur ; une barricade ne doit jamais
// couper complètement un pion du centre. Le premier pion sur la case centrale gagne.
//
// État : 72 nombres.
//   0..3   case du pion de chaque joueur (ligne * 9 + colonne, ligne 0 en haut), −1 s'il a abandonné
//   4..7   barricades restantes de chaque joueur (5 au départ)
//   8..71  intersections 8 × 8 : 0 libre, sinon 2 × joueur + 1 (horizontale) ou + 2 (verticale) ; les
//          parties commencées avant les couleurs n'ont que 1 et 2 (barricades du joueur 0).
// Départs dans les coins (8 pas du centre, comme une traversée au corridor à 2) : 0 en bas à gauche,
// 1 en haut à gauche, 2 en haut à droite, 3 en bas à droite.
// Coups : « m40 » (aller en case 40), « h34 » / « v34 » (barricade à l'intersection (3, 4)), « pass ».

import { nextAlive, SEATS, type Rules4, type Seat } from './types.ts';

export const N = 9;
export const WALLS = 5;
export const MAX_PLIES = 800; // au-delà : partie nulle
const W = 8; // début des intersections

const START = [8 * N, 0, N - 1, N * N - 1];
export const CENTER = 4 * N + 4;
const inside = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function initial(): number[] {
  const b = new Array(72).fill(0);
  for (const s of SEATS) {
    b[s] = START[s];
    b[4 + s] = WALLS;
  }
  return b;
}

const raw = (b: number[], r: number, c: number) => (r < 0 || r > 7 || c < 0 || c > 7 ? 0 : b[W + r * 8 + c]);
/** Barricade à l'intersection (r, c) : 0 aucune, 1 horizontale, 2 verticale. */
export const wallAt = (b: number[], r: number, c: number) => {
  const v = raw(b, r, c);
  return v ? ((v - 1) % 2) + 1 : 0;
};
/** Joueur qui a posé la barricade de l'intersection (r, c). */
export const wallOwner = (b: number[], r: number, c: number) => Math.floor((raw(b, r, c) - 1) / 2) as Seat;

/** Case d'arrivée (la même pour tous : le centre). */
export const atGoal = (_seat: Seat, cell: number) => cell === CENTER;

export function blocked(b: number[], r: number, c: number, dr: number, dc: number): boolean {
  if (dr === 1) return wallAt(b, r, c) === 1 || wallAt(b, r, c - 1) === 1;
  if (dr === -1) return wallAt(b, r - 1, c) === 1 || wallAt(b, r - 1, c - 1) === 1;
  if (dc === 1) return wallAt(b, r, c) === 2 || wallAt(b, r - 1, c) === 2;
  return wallAt(b, r, c - 1) === 2 || wallAt(b, r - 1, c - 1) === 2;
}

/** Plus court chemin du pion de `seat` vers son but, en ignorant les pions (−1 : aucun chemin). */
export function distance(b: number[], seat: Seat): number {
  const start = b[seat];
  if (start < 0) return 0;
  const dist = new Array(N * N).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const cell = queue[k];
    if (atGoal(seat, cell)) return dist[cell];
    const r = Math.floor(cell / N);
    const c = cell % N;
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

/** Déplacements du pion, sauts par-dessus les autres pions compris. */
export function pawnMoves(b: number[], seat: Seat): number[] {
  const me = b[seat];
  if (me < 0) return [];
  const taken = new Set(SEATS.filter((s) => s !== seat && b[s] >= 0).map((s) => b[s]));
  const r = Math.floor(me / N);
  const c = me % N;
  const out = new Set<number>();
  for (const [dr, dc] of STEPS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!inside(nr, nc) || blocked(b, r, c, dr, dc)) continue;
    if (!taken.has(nr * N + nc)) {
      out.add(nr * N + nc);
      continue;
    }
    // Pion collé : saut droit si la case derrière est libre, sinon en diagonale de part et d'autre.
    const jr = nr + dr;
    const jc = nc + dc;
    if (inside(jr, jc) && !blocked(b, nr, nc, dr, dc) && !taken.has(jr * N + jc)) {
      out.add(jr * N + jc);
      continue;
    }
    for (const [sr, sc] of dr === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]]) {
      const tr = nr + sr;
      const tc = nc + sc;
      if (inside(tr, tc) && !blocked(b, nr, nc, sr, sc) && !taken.has(tr * N + tc) && tr * N + tc !== me) out.add(tr * N + tc);
    }
  }
  return [...out];
}

export function wallFits(b: number[], r: number, c: number, o: 1 | 2): boolean {
  if (r < 0 || r > 7 || c < 0 || c > 7 || wallAt(b, r, c) !== 0) return false;
  if (o === 1) return wallAt(b, r, c - 1) !== 1 && wallAt(b, r, c + 1) !== 1;
  return wallAt(b, r - 1, c) !== 2 && wallAt(b, r + 1, c) !== 2;
}

const withWall = (b: number[], r: number, c: number, o: 1 | 2, seat: Seat) => {
  const n = b.slice();
  n[W + r * 8 + c] = 2 * seat + o;
  return n;
};

export function wallLegal(b: number[], seat: Seat, r: number, c: number, o: 1 | 2): boolean {
  if (b[seat] < 0 || b[4 + seat] <= 0 || !wallFits(b, r, c, o)) return false;
  const n = withWall(b, r, c, o, seat);
  return SEATS.every((s) => n[s] < 0 || distance(n, s) >= 0);
}

export function parse(mv: string): { kind: 'm'; cell: number } | { kind: 'w'; r: number; c: number; o: 1 | 2 } | { kind: 'pass' } | null {
  if (mv === 'pass') return { kind: 'pass' };
  let m = /^m([0-9]|[1-7][0-9]|80)$/.exec(mv);
  if (m) return { kind: 'm', cell: Number(m[1]) };
  m = /^([hv])([0-7])([0-7])$/.exec(mv);
  if (m) return { kind: 'w', r: Number(m[2]), c: Number(m[3]), o: m[1] === 'h' ? 1 : 2 };
  return null;
}

export function moves(b: number[], seat: Seat): string[] {
  if (b[seat] < 0) return [];
  const out = pawnMoves(b, seat).map((c) => `m${c}`);
  if (b[4 + seat] > 0) {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        for (const o of [1, 2] as const) if (wallLegal(b, seat, r, c, o)) out.push(`${o === 1 ? 'h' : 'v'}${r}${c}`);
  }
  return out.length ? out : ['pass'];
}

export function isLegal(b: number[], seat: Seat, mv: string): boolean {
  const p = parse(mv);
  if (!p || b[seat] < 0) return false;
  if (p.kind === 'pass') return moves(b, seat)[0] === 'pass';
  if (p.kind === 'm') return pawnMoves(b, seat).includes(p.cell);
  return wallLegal(b, seat, p.r, p.c, p.o);
}

export function apply(b: number[], seat: Seat, mv: string): number[] {
  const p = parse(mv)!;
  if (p.kind === 'pass') return b.slice();
  if (p.kind === 'm') {
    const n = b.slice();
    n[seat] = p.cell;
    return n;
  }
  const n = withWall(b, p.r, p.c, p.o, seat);
  n[4 + seat] -= 1;
  return n;
}

/** Abandon : le pion quitte le plateau. */
export function resign(b: number[], seat: Seat): number[] {
  const n = b.slice();
  n[seat] = -1;
  return n;
}

export const alive = (b: number[], seat: Seat) => b[seat] >= 0;

export function advance(b: number[], mover: Seat, plies: number) {
  if (b[mover] >= 0 && atGoal(mover, b[mover])) return { board: b, next: null, winner: mover, draw: false };
  const left = SEATS.filter((s) => b[s] >= 0);
  if (left.length === 1) return { board: b, next: null, winner: left[0], draw: false };
  if (!left.length || plies >= MAX_PLIES) return { board: b, next: null, winner: null, draw: true };
  return { board: b, next: nextAlive(rules, b, mover), winner: null, draw: false };
}

export const rules: Rules4 = { id: 'quoridor4', initial, moves, isLegal, apply, alive, advance };
