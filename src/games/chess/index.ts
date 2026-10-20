import { mountSoloBoard } from '../board';
import { mountOnline } from '../online';
import type { Game } from '../types';
import { workerAi } from '../aiClient';
import { rules } from './logic';
import { createView } from './view';

export const chess: Game = {
  id: 'chess',
  name: 'Échecs',
  description: 'Solo contre l’ordinateur ou à deux en salon',
  modes: ['solo', 'multi'],
  minPlayers: 2,
  maxPlayers: 2,
  mount: (ctx) => (ctx.mode === 'multi' ? mountOnline(ctx, createView) : mountSoloBoard(ctx, createView, rules, workerAi('chess'))),
};
