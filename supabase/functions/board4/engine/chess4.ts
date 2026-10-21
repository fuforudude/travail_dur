// Copie de src/games/four/engine/chess4.ts (scripts/td-sync.mjs) : ne pas modifier ici.
// Échecs à 4, chacun pour soi, sur le plateau en croix 14 × 14 (les coins de 3 × 3 n'existent pas).
//
// État : 200 nombres.
//   0..195   cases (ligne * 14 + colonne, ligne 0 en haut) : 0 vide, sinon propriétaire * 10 + pièce
//            (propriétaire 1 à 4 = joueur 0 à 3 ; 5 = pièce grise d'un joueur éliminé, simple obstacle
//            qu'on peut prendre) ; pièce : 1 pion, 2 cavalier, 3 fou, 4 tour, 5 dame, 6 roi.
//   196..199 1 si le joueur est encore en jeu.
// Joueurs : 0 rouge (en bas), 1 bleu (à gauche), 2 jaune (en haut), 3 vert (à droite), dans cet ordre.
// Règles : déplacements classiques ; pas de roque ni de prise en passant ; un pion se promeut en dame
// en atteignant la 8e rangée (le centre du plateau). On ne peut pas laisser son roi en échec. Un joueur
// sans coup (mat ou pat) est éliminé ; un roi laissé en prise peut être capturé (élimination aussi).
// Le dernier joueur en jeu gagne ; après 600 coups, celui qui a le plus de matériel. Coups : « 182-154 » (de la case 182 à la case 154).

import { nextAlive, SEATS, type Rules4, type Seat } from './types.ts';

export const N = 14;
export const MAX_PLIES = 600; // au-delà (150 tours) : victoire au matériel
export const DEAD = 5;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
const ALIVE = 196;

export const valid = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N && !((r < 3 || r > 10) && (c < 3 || c > 10));
export const ownerOf = (v: number) => Math.floor(v / 10); // 1..4 joueur (seat + 1), 5 gris
export const typeOf = (v: number) => v % 10;

/** Avancée d'un pion, par joueur. */
const FORWARD: [number, number][] = [[-1, 0], [0, 1], [1, 0], [0, -1]];

export function initial(): number[] {
  const b = new Array(200).fill(0);
  const back = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
  const backMirror = [ROOK, KNIGHT, BISHOP, KING, QUEEN, BISHOP, KNIGHT, ROOK];
  for (let i = 0; i < 8; i++) {
    const k = 3 + i;
    b[13 * N + k] = 10 + back[i]; // rouge, ligne du bas
    b[12 * N + k] = 10 + PAWN;
    b[k * N + 0] = 20 + backMirror[i]; // bleu, colonne de gauche
    b[k * N + 1] = 20 + PAWN;
    b[0 * N + k] = 30 + backMirror[i]; // jaune, ligne du haut
    b[1 * N + k] = 30 + PAWN;
    b[k * N + 13] = 40 + back[i]; // vert, colonne de droite
    b[k * N + 12] = 40 + PAWN;
  }
  for (const s of SEATS) b[ALIVE + s] = 1;
  return b;
}

export const alive = (b: number[], seat: Seat) => b[ALIVE + seat] === 1;

const startRank = (seat: Seat, r: number, c: number) => (seat === 0 ? r === 12 : seat === 1 ? c === 1 : seat === 2 ? r === 1 : c === 12);
const promotes = (seat: Seat, r: number, c: number) => (seat === 0 ? r === 6 : seat === 1 ? c === 7 : seat === 2 ? r === 7 : c === 6);

const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** La case `cell` est-elle attaquée par une pièce d'un joueur en jeu autre que `seat` ? */
export function attacked(b: number[], cell: number, seat: Seat): boolean {
  const r = Math.floor(cell / N);
  const c = cell % N;
  const enemy = (v: number) => {
    const o = ownerOf(v);
    return v !== 0 && o >= 1 && o <= 4 && o !== seat + 1 && b[ALIVE + o - 1] === 1;
  };
  for (const [dr, dc] of KNIGHT_STEPS) {
    const nr = r + dr;
    const nc = c + dc;
    if (valid(nr, nc)) {
      const v = b[nr * N + nc];
      if (enemy(v) && typeOf(v) === KNIGHT) return true;
    }
  }
  for (const [dr, dc] of KING_STEPS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!valid(nr, nc)) continue;
    const v = b[nr * N + nc];
    if (!enemy(v)) continue;
    if (typeOf(v) === KING) return true;
    if (typeOf(v) === PAWN) {
      // Ce pion prend en diagonale vers l'avant : la case visée est à (r, c) = (nr, nc) + avance ± côté.
      const [fr, fc] = FORWARD[ownerOf(v) - 1];
      if (fr !== 0 ? nr + fr === r && Math.abs(nc - c) === 1 : nc + fc === c && Math.abs(nr - r) === 1) return true;
    }
  }
  for (const [dirs, kinds] of [[ROOK_DIRS, [ROOK, QUEEN]], [BISHOP_DIRS, [BISHOP, QUEEN]]] as const) {
    for (const [dr, dc] of dirs) {
      let nr = r + dr;
      let nc = c + dc;
      while (valid(nr, nc)) {
        const v = b[nr * N + nc];
        if (v !== 0) {
          if (enemy(v) && (kinds as readonly number[]).includes(typeOf(v))) return true;
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  }
  return false;
}

const kingOf = (b: number[], seat: Seat) => b.findIndex((v, i) => i < ALIVE && v === (seat + 1) * 10 + KING);

/** Coups possibles sans regarder l'échec : [départ, arrivée]. */
function pseudo(b: number[], seat: Seat): [number, number][] {
  const out: [number, number][] = [];
  const own = seat + 1;
  const free = (v: number) => v === 0;
  const takeable = (v: number) => v !== 0 && ownerOf(v) !== own;
  for (let cell = 0; cell < ALIVE; cell++) {
    const v = b[cell];
    if (v === 0 || ownerOf(v) !== own) continue;
    const r = Math.floor(cell / N);
    const c = cell % N;
    const t = typeOf(v);
    if (t === PAWN) {
      const [fr, fc] = FORWARD[seat];
      const r1 = r + fr;
      const c1 = c + fc;
      if (valid(r1, c1) && free(b[r1 * N + c1])) {
        out.push([cell, r1 * N + c1]);
        const r2 = r1 + fr;
        const c2 = c1 + fc;
        if (startRank(seat, r, c) && valid(r2, c2) && free(b[r2 * N + c2])) out.push([cell, r2 * N + c2]);
      }
      for (const side of [-1, 1]) {
        const tr = r + fr + (fr === 0 ? side : 0);
        const tc = c + fc + (fc === 0 ? side : 0);
        if (valid(tr, tc) && takeable(b[tr * N + tc])) out.push([cell, tr * N + tc]);
      }
    } else if (t === KNIGHT || t === KING) {
      for (const [dr, dc] of t === KNIGHT ? KNIGHT_STEPS : KING_STEPS) {
        const nr = r + dr;
        const nc = c + dc;
        if (valid(nr, nc) && (free(b[nr * N + nc]) || takeable(b[nr * N + nc]))) out.push([cell, nr * N + nc]);
      }
    } else {
      const dirs = t === ROOK ? ROOK_DIRS : t === BISHOP ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [dr, dc] of dirs) {
        let nr = r + dr;
        let nc = c + dc;
        while (valid(nr, nc)) {
          const w = b[nr * N + nc];
          if (w === 0) out.push([cell, nr * N + nc]);
          else {
            if (takeable(w)) out.push([cell, nr * N + nc]);
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
    }
  }
  return out;
}

function play(b: number[], seat: Seat, from: number, to: number): number[] {
  const n = b.slice();
  let v = n[from];
  const r = Math.floor(to / N);
  const c = to % N;
  if (typeOf(v) === PAWN && promotes(seat, r, c)) v = (seat + 1) * 10 + QUEEN;
  n[to] = v;
  n[from] = 0;
  return n;
}

/** Le roi de `seat` est-il en échec ? */
export const inCheck = (b: number[], seat: Seat) => {
  const k = kingOf(b, seat);
  return k >= 0 && attacked(b, k, seat);
};

export function moves(b: number[], seat: Seat): string[] {
  if (!alive(b, seat)) return [];
  const out: string[] = [];
  for (const [from, to] of pseudo(b, seat)) {
    const n = play(b, seat, from, to);
    if (!inCheck(n, seat)) out.push(`${from}-${to}`);
  }
  return out;
}

export const parse = (mv: string) => {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(mv);
  return m ? { from: Number(m[1]), to: Number(m[2]) } : null;
};

export function isLegal(b: number[], seat: Seat, mv: string): boolean {
  const p = parse(mv);
  if (!p || p.from >= ALIVE || p.to >= ALIVE) return false;
  return moves(b, seat).includes(mv);
}

export function apply(b: number[], seat: Seat, mv: string): number[] {
  const p = parse(mv)!;
  return play(b, seat, p.from, p.to);
}

/** Élimine un joueur : ses pièces deviennent grises (obstacles qu'on peut prendre). */
export function eliminate(b: number[], seat: Seat): number[] {
  const n = b.slice();
  n[ALIVE + seat] = 0;
  for (let i = 0; i < ALIVE; i++) if (n[i] !== 0 && ownerOf(n[i]) === seat + 1) n[i] = DEAD * 10 + typeOf(n[i]);
  return n;
}

export function advance(b: number[], mover: Seat, plies: number) {
  let n = b;
  // Roi capturé (il avait été laissé en prise) : son joueur est éliminé.
  for (const s of SEATS) if (alive(n, s) && kingOf(n, s) < 0) n = eliminate(n, s);
  // Les joueurs suivants sans aucun coup (mat ou pat) sont éliminés à leur tour.
  let next = nextAlive(rules, n, mover);
  while (next !== null && SEATS.filter((s) => alive(n, s)).length > 1 && moves(n, next).length === 0) {
    n = eliminate(n, next);
    next = nextAlive(rules, n, next);
  }
  const left = SEATS.filter((s) => alive(n, s));
  if (left.length === 1) return { board: n, next: null, winner: left[0], draw: false };
  if (!left.length) return { board: n, next: null, winner: null, draw: true };
  if (plies >= MAX_PLIES) {
    // Partie trop longue : le joueur en jeu qui a le plus de matériel gagne (égalité : nulle).
    const score = left.map((s) => ({ s, m: material(n, s) })).sort((x, y) => y.m - x.m);
    return score[0].m > score[1].m ? { board: n, next: null, winner: score[0].s, draw: false } : { board: n, next: null, winner: null, draw: true };
  }
  return { board: n, next, winner: null, draw: false };
}

const VALUE = [0, 1, 3, 3, 5, 9, 0];
/** Matériel d'un joueur (pion 1, cavalier et fou 3, tour 5, dame 9). */
export function material(b: number[], seat: Seat): number {
  let m = 0;
  for (let i = 0; i < ALIVE; i++) if (b[i] !== 0 && ownerOf(b[i]) === seat + 1) m += VALUE[typeOf(b[i])];
  return m;
}

export const resign = eliminate;

export const rules: Rules4 = { id: 'chess4', initial, moves, isLegal, apply, alive, advance };
