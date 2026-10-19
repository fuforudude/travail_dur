import type { Game } from './types';

export const games: Game[] = [];

export function getGame(id: string): Game | undefined {
  return games.find((g) => g.id === id);
}
