import { mountSoloBoard } from '../board';
import { mountOnline } from '../online';
import type { Game } from '../types';
import { workerAi } from '../aiClient';
import { rules } from './logic';
import { createView } from './view';

export const quarto: Game = {
  id: 'quarto',
  name: 'Quarto',
  description: 'Aligner un point commun, solo ou à deux',
  modes: ['solo', 'multi'],
  minPlayers: 2,
  maxPlayers: 2,
  mount: (ctx) => (ctx.mode === 'multi' ? mountOnline(ctx, createView) : mountSoloBoard(ctx, createView, rules, workerAi('quarto'), 'quarto')),
};
