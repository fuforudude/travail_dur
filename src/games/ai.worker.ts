// Web Worker : l'ordinateur des jeux de plateau réfléchit ici, sans figer la page.
// Message reçu : { id, game, board, side, history } ; réponse : { id, move } ou { id, error }.

import type { Ai, Side } from './engine';

const AIS: Record<string, () => Promise<{ ai: Ai }>> = {
  chess: () => import('./chess/ai'),
  checkers: () => import('./checkers/ai'),
  quoridor: () => import('./quoridor/ai'),
  quarto: () => import('./quarto/ai'),
};

self.onmessage = async (e: MessageEvent<{ id: number; game: string; board: number[]; side: Side; history: string[] }>) => {
  const { id, game, board, side, history } = e.data;
  try {
    const { ai } = await AIS[game]();
    self.postMessage({ id, move: ai(board, side, history) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
