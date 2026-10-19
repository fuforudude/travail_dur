import { connect4 } from './connect4';
import { game2048 } from './g2048';
import { tetris } from './tetris';
import { tictactoe } from './tictactoe';
import type { Game } from './types';

export const games: Game[] = [game2048, tetris, connect4, tictactoe];

export function getGame(id: string): Game | undefined {
  return games.find((g) => g.id === id);
}
