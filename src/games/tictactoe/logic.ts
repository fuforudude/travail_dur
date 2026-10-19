/** Plateau 3×3, index 0..8 ligne par ligne. 0 = vide, 1 = X, 2 = O. Mêmes règles que public.ttt_line. */
export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function findLine(board: number[]): { who: 1 | 2; line: number[] } | null {
  for (const l of LINES) {
    const v = board[l[0]];
    if (v && v === board[l[1]] && v === board[l[2]]) return { who: v as 1 | 2, line: l };
  }
  return null;
}

export const isFull = (board: number[]) => board.every((v) => v !== 0);

/** Valeur exacte d'une position pour `me` (minimax) : 1 gagné, 0 nul, -1 perdu. */
function minimax(board: number[], me: 1 | 2, toPlay: 1 | 2): number {
  const w = findLine(board);
  if (w) return w.who === me ? 1 : -1;
  if (isFull(board)) return 0;
  let best = toPlay === me ? -2 : 2;
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = toPlay;
    const v = minimax(board, me, (3 - toPlay) as 1 | 2);
    board[i] = 0;
    best = toPlay === me ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/**
 * IA : joue parfaitement la plupart du temps, mais se trompe parfois
 * (sinon on ne peut jamais la battre, ce qui n'est pas drôle).
 */
export function aiMove(board: number[], me: 1 | 2, mistakeRate = 0.2): number {
  const free = board.flatMap((v, i) => (v ? [] : [i]));
  if (Math.random() < mistakeRate) return free[Math.floor(Math.random() * free.length)];
  let best = -2;
  let moves: number[] = [];
  for (const i of free) {
    const b = board.slice();
    b[i] = me;
    const v = minimax(b, me, (3 - me) as 1 | 2);
    if (v > best) {
      best = v;
      moves = [i];
    } else if (v === best) moves.push(i);
  }
  return moves[Math.floor(Math.random() * moves.length)];
}
