export const ROWS = 6;
export const COLS = 7;

/** 0 = vide, 1 = joueur 1, 2 = joueur 2. Index = ligne * COLS + colonne, ligne 0 en haut. */
export type Cell = 0 | 1 | 2;
export type Board = Cell[];

export function emptyBoard(): Board {
  return new Array(ROWS * COLS).fill(0);
}

export function canDrop(board: Board, col: number): boolean {
  return col >= 0 && col < COLS && board[col] === 0;
}

export function validCols(board: Board): number[] {
  return [...Array(COLS).keys()].filter((c) => canDrop(board, c));
}

/** Retourne le nouveau plateau et la case occupée, ou null si la colonne est pleine. */
export function drop(board: Board, col: number, who: 1 | 2): { board: Board; index: number } | null {
  if (!canDrop(board, col)) return null;
  for (let r = ROWS - 1; r >= 0; r--) {
    const i = r * COLS + col;
    if (board[i] === 0) {
      const next = board.slice();
      next[i] = who;
      return { board: next, index: i };
    }
  }
  return null;
}

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function findWin(board: Board): { who: 1 | 2; line: number[] } | null {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const who = board[r * COLS + c];
      if (!who) continue;
      for (const [dr, dc] of DIRS) {
        const line = [];
        for (let k = 0; k < 4; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr * COLS + cc] !== who) break;
          line.push(rr * COLS + cc);
        }
        if (line.length === 4) return { who, line };
      }
    }
  }
  return null;
}

export function isFull(board: Board): boolean {
  return validCols(board).length === 0;
}

/** IA simple : gagner si possible, sinon bloquer, sinon le centre, sinon au hasard. */
export function aiMove(board: Board, me: 1 | 2): number {
  const other = me === 1 ? 2 : 1;
  const cols = validCols(board);
  for (const who of [me, other] as const) {
    for (const c of cols) {
      const r = drop(board, c, who);
      if (r && findWin(r.board)?.who === who) return c;
    }
  }
  const center = Math.floor(COLS / 2);
  if (cols.includes(center)) return center;
  return cols[Math.floor(Math.random() * cols.length)];
}
