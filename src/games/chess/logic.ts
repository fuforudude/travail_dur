// Échecs. Doit rester identique à public.chess_* (supabase/migrations/0006_plateaux.sql).
//
// État : 67 nombres.
//   0..63  cases, ligne 0 = 8e rangée (côté noir), colonne 0 = colonne a.
//          0 vide, 1..6 pion cavalier fou tour dame roi blancs, 7..12 les mêmes en noir.
//   64     droits de roque (1 petit roque blanc, 2 grand roque blanc, 4 et 8 pour les noirs)
//   65     case de prise en passant, ou -1
//   66     demi-coups depuis la dernière prise ou le dernier coup de pion (règle des 50 coups)
// Camp 1 = blancs, camp 2 = noirs. Coups en notation UCI : « e2e4 », « e7e8q ».

import type { Outcome, Rules, Side } from '../board';

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const colorOf = (p: number): 0 | Side => (p === 0 ? 0 : p <= 6 ? 1 : 2);
export const typeOf = (p: number) => (p === 0 ? 0 : ((p - 1) % 6) + 1);
const make = (side: Side, type: number) => type + (side === 2 ? 6 : 0);

const BACK = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];

export function initial(): number[] {
  const b = new Array(67).fill(0);
  for (let c = 0; c < 8; c++) {
    b[c] = make(2, BACK[c]);
    b[8 + c] = make(2, PAWN);
    b[48 + c] = make(1, PAWN);
    b[56 + c] = make(1, BACK[c]);
  }
  b[64] = 15;
  b[65] = -1;
  return b;
}

export const squareName = (i: number) => 'abcdefgh'[i % 8] + String(8 - Math.floor(i / 8));
export const parseSquare = (s: string) => {
  const c = 'abcdefgh'.indexOf(s[0]);
  const r = 8 - Number(s[1]);
  return c < 0 || !(r >= 0 && r < 8) ? -1 : r * 8 + c;
};

const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/** La case `sq` est-elle attaquée par le camp `by` ? */
export function attacked(b: number[], sq: number, by: Side): boolean {
  const r = Math.floor(sq / 8);
  const c = sq % 8;
  const at = (rr: number, cc: number) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 ? b[rr * 8 + cc] : -1);
  // Pions : un pion blanc attaque vers le haut, donc depuis la ligne du dessous.
  const pr = by === 1 ? r + 1 : r - 1;
  if (at(pr, c - 1) === make(by, PAWN) || at(pr, c + 1) === make(by, PAWN)) return true;
  for (const [dr, dc] of KNIGHT_STEPS) if (at(r + dr, c + dc) === make(by, KNIGHT)) return true;
  for (const [dr, dc] of KING_STEPS) if (at(r + dr, c + dc) === make(by, KING)) return true;
  for (const [dirs, a, q] of [
    [DIAG, BISHOP, QUEEN],
    [ORTHO, ROOK, QUEEN],
  ] as const) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr;
      let cc = c + dc;
      while (at(rr, cc) === 0) {
        rr += dr;
        cc += dc;
      }
      const p = at(rr, cc);
      if (p === make(by, a) || p === make(by, q)) return true;
    }
  }
  return false;
}

export function inCheck(b: number[], side: Side): boolean {
  const k = b.indexOf(make(side, KING));
  return k >= 0 && k < 64 && attacked(b, k, (3 - side) as Side);
}

/** Coups possibles sans vérifier que le roi reste hors d'échec. */
function pseudoMoves(b: number[], side: Side): string[] {
  const out: string[] = [];
  const enemy = (3 - side) as Side;
  const add = (from: number, to: number) => out.push(squareName(from) + squareName(to));
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (colorOf(p) !== side) continue;
    const r = Math.floor(sq / 8);
    const c = sq % 8;
    const t = typeOf(p);
    if (t === PAWN) {
      const dir = side === 1 ? -1 : 1;
      const start = side === 1 ? 6 : 1;
      const last = side === 1 ? 0 : 7;
      const push = (to: number) => {
        if (Math.floor(to / 8) === last) for (const x of 'qrbn') out.push(squareName(sq) + squareName(to) + x);
        else add(sq, to);
      };
      const one = sq + dir * 8;
      if (b[one] === 0) {
        push(one);
        const two = one + dir * 8;
        if (r === start && b[two] === 0) add(sq, two);
      }
      for (const dc of [-1, 1]) {
        const cc = c + dc;
        if (cc < 0 || cc > 7) continue;
        const to = one + dc;
        if (colorOf(b[to]) === enemy || to === b[65]) push(to);
      }
    } else if (t === KNIGHT || t === KING) {
      for (const [dr, dc] of t === KNIGHT ? KNIGHT_STEPS : KING_STEPS) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        if (colorOf(b[rr * 8 + cc]) !== side) add(sq, rr * 8 + cc);
      }
      if (t === KING) {
        // Roque : roi et tour à leur place (garanti par les droits), cases libres, roi jamais en prise.
        const home = side === 1 ? 60 : 4;
        const rights = b[64] >> (side === 1 ? 0 : 2);
        if (sq === home && !attacked(b, home, enemy)) {
          if (rights & 1 && b[home + 1] === 0 && b[home + 2] === 0 && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy))
            add(sq, home + 2);
          if (rights & 2 && b[home - 1] === 0 && b[home - 2] === 0 && b[home - 3] === 0 && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy))
            add(sq, home - 2);
        }
      }
    } else {
      const dirs = t === BISHOP ? DIAG : t === ROOK ? ORTHO : [...DIAG, ...ORTHO];
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const q = b[rr * 8 + cc];
          if (colorOf(q) === side) break;
          add(sq, rr * 8 + cc);
          if (q !== 0) break;
          rr += dr;
          cc += dc;
        }
      }
    }
  }
  return out;
}

export function apply(b: number[], side: Side, mv: string): number[] {
  const n = b.slice();
  const from = parseSquare(mv.slice(0, 2));
  const to = parseSquare(mv.slice(2, 4));
  const p = n[from];
  const t = typeOf(p);
  const captured = n[to];
  n[from] = 0;
  n[to] = mv.length > 4 ? make(side, ' pnbrqk'.indexOf(mv[4])) : p;
  if (t === PAWN && to === b[65] && captured === 0) n[to + (side === 1 ? 8 : -8)] = 0; // prise en passant
  if (t === KING && Math.abs(to - from) === 2) {
    // Roque : la tour passe de l'autre côté du roi.
    const rookFrom = to > from ? from + 3 : from - 4;
    const rookTo = to > from ? from + 1 : from - 1;
    n[rookTo] = n[rookFrom];
    n[rookFrom] = 0;
  }
  let rights = b[64];
  if (t === KING) rights &= side === 1 ? ~3 : ~12;
  for (const [sq, bit] of [
    [63, 1],
    [56, 2],
    [7, 4],
    [0, 8],
  ])
    if (from === sq || to === sq) rights &= ~bit;
  n[64] = rights;
  n[65] = t === PAWN && Math.abs(to - from) === 16 ? (from + to) / 2 : -1;
  n[66] = t === PAWN || captured !== 0 ? 0 : b[66] + 1;
  return n;
}

export function moves(b: number[], side: Side): string[] {
  return pseudoMoves(b, side).filter((mv) => !inCheck(apply(b, side, mv), side));
}

export function isLegal(b: number[], side: Side, mv: string): boolean {
  return moves(b, side).includes(mv);
}

/** Matériel insuffisant pour mater : rois seuls, ou un seul fou ou cavalier en plus. */
function insufficient(b: number[]): boolean {
  let minors = 0;
  for (let i = 0; i < 64; i++) {
    const t = typeOf(b[i]);
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    if (t === KNIGHT || t === BISHOP) minors++;
  }
  return minors <= 1;
}

const positionKey = (b: number[], side: Side) => b.slice(0, 66).join(',') + ':' + side;

export function outcome(b: number[], next: Side, history: string[]): Outcome | null {
  if (!moves(b, next).length) return { winner: inCheck(b, next) ? ((3 - next) as Side) : null };
  if (b[66] >= 100 || insufficient(b)) return { winner: null };
  // Triple répétition : on rejoue la partie depuis le début.
  const key = positionKey(b, next);
  let seen = 0;
  let x = initial();
  let side: Side = 1;
  if (positionKey(x, side) === key) seen++;
  for (const mv of history) {
    x = apply(x, side, mv);
    side = (3 - side) as Side;
    if (positionKey(x, side) === key) seen++;
  }
  return seen >= 3 ? { winner: null } : null;
}

export const rules: Rules = { initial, moves, isLegal, apply, outcome };
