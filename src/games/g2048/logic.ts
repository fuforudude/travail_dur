import { xorshift32 } from './rng';

export type Grid = number[]; // 16 cases, 0 = vide
export type Dir = 'up' | 'down' | 'left' | 'right';

export const SIZE = 4;

export function emptyGrid(): Grid {
  return new Array(SIZE * SIZE).fill(0);
}

/**
 * Fait apparaître une tuile. Tirage déterministe à partir de `seed` pour que le serveur
 * puisse rejouer la partie à l'identique (voir public.g2048_replay). Retourne la nouvelle graine.
 */
export function addRandom(grid: Grid, seed: number): { grid: Grid; seed: number } {
  const free = grid.flatMap((v, i) => (v ? [] : [i]));
  if (!free.length) return { grid, seed };
  const next = grid.slice();
  seed = xorshift32(seed);
  const pos = free[Math.floor((seed * free.length) / 4294967296)];
  seed = xorshift32(seed);
  next[pos] = seed % 10 === 0 ? 4 : 2;
  return { grid: next, seed };
}

export function newGame(seed: number): { grid: Grid; seed: number } {
  const a = addRandom(emptyGrid(), seed);
  return addRandom(a.grid, a.seed);
}

/** Indices d'une ligne, dans l'ordre où les tuiles glissent. */
function line(dir: Dir, k: number): number[] {
  const idx: number[] = [];
  for (let j = 0; j < SIZE; j++) {
    switch (dir) {
      case 'left': idx.push(k * SIZE + j); break;
      case 'right': idx.push(k * SIZE + (SIZE - 1 - j)); break;
      case 'up': idx.push(j * SIZE + k); break;
      case 'down': idx.push((SIZE - 1 - j) * SIZE + k); break;
    }
  }
  return idx;
}

export function move(grid: Grid, dir: Dir): { grid: Grid; gained: number; moved: boolean; merged: number[] } {
  const next = grid.slice();
  let gained = 0;
  const merged: number[] = [];
  for (let k = 0; k < SIZE; k++) {
    const idx = line(dir, k);
    const values = idx.map((i) => grid[i]).filter(Boolean);
    const out: number[] = [];
    for (let j = 0; j < values.length; j++) {
      if (values[j] === values[j + 1]) {
        out.push(values[j] * 2);
        gained += values[j] * 2;
        merged.push(idx[out.length - 1]);
        j++;
      } else out.push(values[j]);
    }
    idx.forEach((i, j) => (next[i] = out[j] ?? 0));
  }
  const moved = next.some((v, i) => v !== grid[i]);
  return { grid: next, gained, moved, merged };
}

export function canMove(grid: Grid): boolean {
  return (['up', 'down', 'left', 'right'] as Dir[]).some((d) => move(grid, d).moved);
}

/** Codage des coups envoyé au serveur : une lettre par coup. */
export const DIR_CODE: Record<Dir, string> = { up: 'U', down: 'D', left: 'L', right: 'R' };
const CODE_DIR: Record<string, Dir> = { U: 'up', D: 'down', L: 'left', R: 'right' };

/** Rejoue une partie depuis sa graine (reprise après rechargement, et même calcul que le serveur). */
export function replay(seed: number, moves: string): { grid: Grid; seed: number; score: number } {
  let { grid, seed: s } = newGame(seed);
  let score = 0;
  for (const c of moves) {
    const r = move(grid, CODE_DIR[c]);
    if (!r.moved) throw new Error('coup invalide');
    score += r.gained;
    ({ grid, seed: s } = addRandom(r.grid, s));
  }
  return { grid, seed: s, score };
}
