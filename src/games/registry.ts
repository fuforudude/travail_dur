import type { Game } from './types';

/**
 * Catalogue des jeux. Le code de chaque jeu n'est téléchargé qu'au moment d'y jouer (`load`) :
 * l'accueil n'a besoin que du nom et de la description.
 */
export interface GameInfo {
  id: string;
  name: string;
  description: string;
  modes: Game['modes'];
  load(): Promise<Game>;
}

export const games: GameInfo[] = [
  { id: '2048', name: '2048', description: 'Solo · fusionner les tuiles', modes: ['solo'], load: () => import('./g2048').then((m) => m.game2048) },
  { id: 'tetris', name: 'Tetris', description: 'Solo · classé', modes: ['solo'], load: () => import('./tetris').then((m) => m.tetris) },
  { id: 'wordle', name: 'Wordle', description: 'Mot du jour classé, ou entraînement', modes: ['solo'], load: () => import('./wordle').then((m) => m.wordle) },
  { id: 'flappy', name: 'Flappy Bird', description: 'Solo · classé', modes: ['solo'], load: () => import('./flappy').then((m) => m.flappy) },
  { id: 'td', name: 'Tower defense', description: 'Campagne de 20 niveaux, défis bonus, mode infini classé', modes: ['solo'], load: () => import('./towerdefense').then((m) => m.towerDefense) },
  { id: 'connect4', name: 'Puissance 4', description: 'Solo contre l’ordinateur ou à deux en salon', modes: ['solo', 'multi'], load: () => import('./connect4').then((m) => m.connect4) },
  { id: 'tictactoe', name: 'Morpion', description: 'Solo contre l’ordinateur ou à deux en salon', modes: ['solo', 'multi'], load: () => import('./tictactoe').then((m) => m.tictactoe) },
  { id: 'chess', name: 'Échecs', description: 'Solo contre l’ordinateur ou à deux en salon', modes: ['solo', 'multi'], load: () => import('./chess').then((m) => m.chess) },
  { id: 'checkers', name: 'Dames', description: 'Dames internationales, solo ou à deux', modes: ['solo', 'multi'], load: () => import('./checkers').then((m) => m.checkers) },
  { id: 'quoridor', name: 'Quoridor', description: 'Le corridor : murs et course, solo ou à deux', modes: ['solo', 'multi'], load: () => import('./quoridor').then((m) => m.quoridor) },
  { id: 'quarto', name: 'Quarto', description: 'Aligner un point commun, solo ou à deux', modes: ['solo', 'multi'], load: () => import('./quarto').then((m) => m.quarto) },
];

export function getGame(id: string): GameInfo | undefined {
  return games.find((g) => g.id === id);
}
