export type Grid = number[]; // 16 cases, 0 = vide
export type Dir = 'up' | 'down' | 'left' | 'right';

export const SIZE = 4;

export function emptyGrid(): Grid {
  return new Array(SIZE * SIZE).fill(0);
}

export function addRandom(grid: Grid): Grid {
  const free = grid.flatMap((v, i) => (v ? [] : [i]));
  if (!free.length) return grid;
  const next = grid.slice();
  next[free[Math.floor(Math.random() * free.length)]] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

export function newGame(): Grid {
  return addRandom(addRandom(emptyGrid()));
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
