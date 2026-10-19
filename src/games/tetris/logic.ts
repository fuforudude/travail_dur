import { xorshift32 } from '../g2048/rng';

// Règles volontairement simples et déterministes : elles doivent rester identiques à
// public.tetris_replay (supabase/migrations/0002_jeux.sql), qui rejoue chaque partie classée.

export const W = 10;
export const H = 20;

/** Actions, une lettre chacune : c'est ce qui est envoyé au serveur. */
export type Action = 'L' | 'R' | 'C' | 'A' | 'D' | 'G' | 'H';

// Pièces 1..7 : I O T S Z J L. Pour chaque rotation, 4 cases (x, y) dans une boîte 4×4.
const SHAPES: number[][][] = [
  [[0,1, 1,1, 2,1, 3,1], [2,0, 2,1, 2,2, 2,3], [0,2, 1,2, 2,2, 3,2], [1,0, 1,1, 1,2, 1,3]],
  [[1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1], [1,0, 2,0, 1,1, 2,1]],
  [[1,0, 0,1, 1,1, 2,1], [1,0, 1,1, 2,1, 1,2], [0,1, 1,1, 2,1, 1,2], [1,0, 0,1, 1,1, 1,2]],
  [[1,0, 2,0, 0,1, 1,1], [1,0, 1,1, 2,1, 2,2], [1,1, 2,1, 0,2, 1,2], [0,0, 0,1, 1,1, 1,2]],
  [[0,0, 1,0, 1,1, 2,1], [2,0, 1,1, 2,1, 1,2], [0,1, 1,1, 1,2, 2,2], [1,0, 0,1, 1,1, 0,2]],
  [[0,0, 0,1, 1,1, 2,1], [1,0, 2,0, 1,1, 1,2], [0,1, 1,1, 2,1, 2,2], [1,0, 1,1, 0,2, 1,2]],
  [[2,0, 0,1, 1,1, 2,1], [1,0, 1,1, 1,2, 2,2], [0,1, 1,1, 2,1, 0,2], [0,0, 1,0, 1,1, 1,2]],
];
const KICKS = [0, -1, 1, -2, 2];
const LINE_SCORES = [0, 100, 300, 500, 800];

export function shape(piece: number, rot: number): number[] {
  return SHAPES[piece - 1][rot];
}

/** Délai de chute automatique (ms) selon le niveau. */
export function gravityMs(level: number): number {
  return Math.max(100, 800 - (level - 1) * 70);
}

export interface State {
  board: number[]; // W×H, 0 = vide, sinon numéro de pièce
  rng: number;
  queue: number[];
  piece: number;
  rot: number;
  x: number;
  y: number;
  score: number;
  lines: number;
  level: number;
  over: boolean;
  /** Durée minimale de la partie selon la gravité (même calcul que le serveur). */
  expectedMs: number;
}

function refill(s: State): void {
  const bag = [1, 2, 3, 4, 5, 6, 7];
  for (let i = 6; i >= 1; i--) {
    s.rng = xorshift32(s.rng);
    const j = Math.floor((s.rng * (i + 1)) / 4294967296);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  s.queue.push(...bag);
}

function nextPiece(s: State): void {
  s.piece = s.queue.shift()!;
  if (s.queue.length === 0) refill(s);
  s.rot = 0;
  s.x = 3;
  s.y = 0;
}

export function fits(s: State, piece: number, rot: number, x: number, y: number): boolean {
  const c = shape(piece, rot);
  for (let i = 0; i < 4; i++) {
    const cx = x + c[i * 2];
    const cy = y + c[i * 2 + 1];
    if (cx < 0 || cx >= W || cy >= H || (cy >= 0 && s.board[cy * W + cx] !== 0)) return false;
  }
  return true;
}

export function newGame(seed: number): State {
  const s: State = {
    board: new Array(W * H).fill(0),
    rng: seed,
    queue: [],
    piece: 0,
    rot: 0,
    x: 3,
    y: 0,
    score: 0,
    lines: 0,
    level: 1,
    over: false,
    expectedMs: 0,
  };
  refill(s);
  nextPiece(s);
  return s;
}

/** Pose la pièce, efface les lignes, fait apparaître la suivante. Retourne le nombre de lignes. */
function lock(s: State): number {
  const c = shape(s.piece, s.rot);
  for (let i = 0; i < 4; i++) s.board[(s.y + c[i * 2 + 1]) * W + s.x + c[i * 2]] = s.piece;
  const kept: number[] = [];
  let cleared = 0;
  for (let y = 0; y < H; y++) {
    const row = s.board.slice(y * W, y * W + W);
    if (row.every((v) => v !== 0)) cleared++;
    else kept.push(...row);
  }
  if (cleared) {
    s.board = new Array(cleared * W).fill(0).concat(kept);
    s.score += LINE_SCORES[cleared] * s.level;
    s.lines += cleared;
    s.level = 1 + Math.floor(s.lines / 10);
  }
  nextPiece(s);
  if (!fits(s, s.piece, s.rot, s.x, s.y)) s.over = true;
  return cleared;
}

/**
 * Applique une action (modifie `s`). Retourne le nombre de lignes effacées si une pièce
 * a été posée, -1 sinon. Lève une erreur si la partie est déjà finie.
 */
export function step(s: State, a: Action): number {
  if (s.over) throw new Error('partie terminée');
  switch (a) {
    case 'L':
    case 'R': {
      const nx = s.x + (a === 'L' ? -1 : 1);
      if (fits(s, s.piece, s.rot, nx, s.y)) s.x = nx;
      return -1;
    }
    case 'C':
    case 'A': {
      const nr = (s.rot + (a === 'C' ? 1 : 3)) % 4;
      for (const k of KICKS) {
        if (fits(s, s.piece, nr, s.x + k, s.y)) {
          s.rot = nr;
          s.x += k;
          break;
        }
      }
      return -1;
    }
    case 'G': // la gravité descend d'une ligne comme une descente douce, sans points
    case 'D':
      if (a === 'G') s.expectedMs += gravityMs(s.level);
      if (fits(s, s.piece, s.rot, s.x, s.y + 1)) {
        s.y++;
        if (a === 'D') s.score += 1;
        return -1;
      }
      return lock(s);
    case 'H':
      while (fits(s, s.piece, s.rot, s.x, s.y + 1)) {
        s.y++;
        s.score += 2;
      }
      return lock(s);
  }
}

/** Ligne où la pièce courante se poserait (pour l'affichage du « fantôme »). */
export function ghostY(s: State): number {
  let y = s.y;
  while (fits(s, s.piece, s.rot, s.x, y + 1)) y++;
  return y;
}

export function replay(seed: number, events: string): State {
  const s = newGame(seed);
  for (const e of events) step(s, e as Action);
  return s;
}
