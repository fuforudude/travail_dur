import { negamax, type Side } from '../engine';
import { blocked, distance, goalRow, N, pawnMoves, rules, wallLegal } from './logic';

/** Plus court chemin (cases successives) du pion de `side` vers son but. */
function path(b: number[], side: Side): number[] {
  const goal = goalRow(side);
  const prev = new Array(N * N).fill(-2);
  const start = b[side - 1];
  prev[start] = -1;
  const queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const cell = queue[k];
    const r = Math.floor(cell / N);
    const c = cell % N;
    if (r === goal) {
      const out: number[] = [];
      for (let x = cell; x !== -1; x = prev[x]) out.unshift(x);
      return out;
    }
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N || blocked(b, r, c, dr, dc) || prev[nr * N + nc] !== -2) continue;
      prev[nr * N + nc] = cell;
      queue.push(nr * N + nc);
    }
  }
  return [];
}

/**
 * Coups étudiés : les déplacements du pion, et seulement les murs qui coupent les premiers pas
 * du chemin adverse (sinon plus de 100 murs possibles à chaque coup).
 */
function candidates(b: number[], side: Side): string[] {
  const out = pawnMoves(b, side).map((c) => `m${c}`);
  if (b[1 + side] <= 0) return out;
  const opp = (3 - side) as Side;
  const p = path(b, opp).slice(0, 5);
  const seen = new Set<string>();
  for (let k = 0; k + 1 < p.length; k++) {
    const a = p[k];
    const z = p[k + 1];
    const r = Math.min(Math.floor(a / N), Math.floor(z / N));
    const c = Math.min(a % N, z % N);
    const horizontal = Math.floor(a / N) !== Math.floor(z / N);
    // Murs qui séparent a et z : deux positions possibles le long de l'arête.
    const spots = horizontal ? [[r, c - 1], [r, c]] : [[r - 1, c], [r, c]];
    for (const [wr, wc] of spots) {
      const mv = `${horizontal ? 'h' : 'v'}${wr}${wc}`;
      if (seen.has(mv) || wr < 0 || wr > 7 || wc < 0 || wc > 7) continue;
      seen.add(mv);
      if (wallLegal(b, side, wr, wc, horizontal ? 1 : 2)) out.push(mv);
    }
  }
  return out;
}

function evaluate(b: number[], side: Side): number {
  const opp = (3 - side) as Side;
  return (distance(b, opp) - distance(b, side)) * 10 + (b[1 + side] - b[1 + opp]) * 3;
}

export const ai = negamax(rules, {
  depth: 2,
  evaluate,
  moves: candidates,
  over: (b, mover) => (Math.floor(b[mover - 1] / N) === goalRow(mover) ? { winner: mover } : null),
  stuck: () => 0,
});
