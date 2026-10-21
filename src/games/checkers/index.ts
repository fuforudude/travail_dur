import { mountSoloBoard } from '../board';
import { mountOnline } from '../online';
import type { Game } from '../types';
import { workerAi } from '../aiClient';
import { rules } from './logic';
import { createView } from './view';

export const checkers: Game = {
  id: 'checkers',
  name: 'Dames',
  description: 'Dames internationales, solo ou à deux',
  modes: ['solo', 'multi'],
  minPlayers: 2,
  maxPlayers: 2,
  mount: (ctx) => (ctx.mode === 'multi' ? mountOnline(ctx, createView) : mountSoloBoard(ctx, createView, rules, workerAi('checkers'), 'checkers')),
};
