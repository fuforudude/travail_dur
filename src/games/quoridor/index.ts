import { mountSoloBoard } from '../board';
import { mountOnline } from '../online';
import type { Game } from '../types';
import { ai } from './ai';
import { rules } from './logic';
import { createView } from './view';

export const quoridor: Game = {
  id: 'quoridor',
  name: 'Quoridor',
  description: 'Le corridor : murs et course, solo ou à deux',
  modes: ['solo', 'multi'],
  minPlayers: 2,
  maxPlayers: 2,
  mount: (ctx) => (ctx.mode === 'multi' ? mountOnline(ctx, createView) : mountSoloBoard(ctx, createView, rules, ai)),
};
