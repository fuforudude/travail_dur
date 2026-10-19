import { game2048 } from './g2048';
import type { Game } from './types';

export const games: Game[] = [game2048];

export function getGame(id: string): Game | undefined {
  return games.find((g) => g.id === id);
}
