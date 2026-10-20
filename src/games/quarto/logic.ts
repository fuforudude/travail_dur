// Quarto. Doit rester identique à public.quarto_* (supabase/migrations/0006_plateaux.sql).
//
// 16 pièces, numérotées 0..15 ; chaque bit est une caractéristique :
//   1 haute (sinon basse), 2 foncée (sinon claire), 4 carrée (sinon ronde), 8 creuse (sinon pleine).
// État : 17 nombres.
//   0..15  cases du plateau 4×4 : 0 vide, sinon numéro de pièce + 1
//   16     pièce à placer par le joueur dont c'est le tour (numéro + 1), 0 au tout premier coup
// Un tour = poser la pièce reçue, puis choisir celle que l'adversaire posera.
// Coups : « g5 » (premier coup : donner la pièce 5), « p10g3 » (poser en case 10, donner la 3),
// « p10 » (poser sans rien donner : seulement si la pose gagne ou remplit le plateau).

import type { Outcome, Rules, Side } from '../board';

export const LINES = [
  [0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15],
  [0, 4, 8, 12], [1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15],
  [0, 5, 10, 15], [3, 6, 9, 12],
];

export function initial(): number[] {
  return new Array(17).fill(0);
}

/** Première ligne complète dont les 4 pièces partagent une caractéristique, ou null. */
export function winningLine(b: number[]): number[] | null {
  for (const line of LINES) {
    if (line.some((i) => b[i] === 0)) continue;
    let all = 15;
    let none = 15;
    for (const i of line) {
      all &= b[i] - 1;
      none &= ~(b[i] - 1) & 15;
    }
    if (all || none) return line;
  }
  return null;
}

/** Pièces encore disponibles (ni posées, ni en main). */
export function available(b: number[]): number[] {
  const used = new Set<number>();
  for (let i = 0; i < 17; i++) if (b[i]) used.add(b[i] - 1);
  return [...Array(16).keys()].filter((p) => !used.has(p));
}

export function moves(b: number[]): string[] {
  const free = available(b);
  if (b[16] === 0) return free.map((p) => `g${p}`);
  const out: string[] = [];
  for (let cell = 0; cell < 16; cell++) {
    if (b[cell]) continue;
    const n = b.slice();
    n[cell] = b[16];
    if (winningLine(n) || !free.length) out.push(`p${cell}`);
    else for (const p of free) out.push(`p${cell}g${p}`);
  }
  return out;
}

export function isLegal(b: number[], _side: Side, mv: string): boolean {
  return moves(b).includes(mv);
}

export function apply(b: number[], _side: Side, mv: string): number[] {
  const n = b.slice();
  const m = /^(?:p(\d+))?(?:g(\d+))?$/.exec(mv)!;
  if (m[1] !== undefined) n[Number(m[1])] = b[16];
  n[16] = m[2] !== undefined ? Number(m[2]) + 1 : 0;
  return n;
}

export function outcome(b: number[], next: Side): Outcome | null {
  const line = winningLine(b);
  if (line) return { winner: (3 - next) as Side, line };
  if (b.slice(0, 16).every((v) => v !== 0)) return { winner: null };
  return null;
}

export const rules: Rules = { initial, moves: (b) => moves(b), isLegal, apply, outcome };
