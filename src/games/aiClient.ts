// Ordinateur des jeux de plateau, exécuté dans un Web Worker (games/ai.worker.ts).
// Si le navigateur refuse le worker, on calcule sur la page, comme avant.

import type { Side } from './engine';

type AsyncAi = (b: number[], side: Side, history: string[]) => Promise<string>;
type Game = 'chess' | 'checkers' | 'quoridor' | 'quarto';

const LOCAL: Record<Game, () => Promise<{ ai: (b: number[], side: Side, history: string[]) => string }>> = {
  chess: () => import('./chess/ai'),
  checkers: () => import('./checkers/ai'),
  quoridor: () => import('./quoridor/ai'),
  quarto: () => import('./quarto/ai'),
};

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { ok: (mv: string) => void; ko: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; move?: string; error?: string }>) => {
      const w = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (e.data.move) w?.ok(e.data.move);
      else w?.ko(new Error(e.data.error ?? 'ordinateur indisponible'));
    };
    worker.onerror = () => {
      // Worker inutilisable : les demandes en cours (et les suivantes) passent par la page.
      worker = null;
      for (const w of waiting.values()) w.ko(new Error('worker'));
      waiting.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function workerAi(game: Game): AsyncAi {
  return async (board, side, history) => {
    const w = getWorker();
    if (w) {
      try {
        return await new Promise<string>((ok, ko) => {
          const id = nextId++;
          waiting.set(id, { ok, ko });
          w.postMessage({ id, game, board, side, history });
        });
      } catch {
        // on retombe sur le calcul local
      }
    }
    const { ai } = await LOCAL[game]();
    return ai(board, side, history);
  };
}
