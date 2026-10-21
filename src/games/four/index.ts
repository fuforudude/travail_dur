// Jeux à 4 : échecs à 4 et corridor à 4, en solo (contre 3 ordinateurs) ou en ligne depuis un salon.

import type { Game, GameContext } from '../types';
import { mountSolo4 } from './solo4';
import './four.css';

const mount = (game: 'chess4' | 'quoridor4') => (ctx: GameContext) =>
  ctx.mode === 'multi' && ctx.match
    ? (() => {
        let off: (() => void) | null = null;
        let gone = false;
        // Le code du mode en ligne n'est chargé qu'au besoin.
        void import('./online4').then((m) => {
          if (!gone) off = m.mountOnline4(ctx, game, ctx.match!);
        });
        return () => {
          gone = true;
          off?.();
        };
      })()
    : mountSolo4(ctx, game);

export const chess4: Game = {
  id: 'chess4',
  name: 'Échecs à 4',
  description: 'Chacun pour soi sur le plateau en croix',
  modes: ['solo', 'multi'],
  mount: mount('chess4'),
};

export const quoridor4: Game = {
  id: 'quoridor4',
  name: 'Corridor à 4',
  description: 'Le premier au centre gagne, cinq barricades chacun',
  modes: ['solo', 'multi'],
  mount: mount('quoridor4'),
};
