import { getSettings } from '../core/settings';
import { getGame } from '../games/registry';
import { navigate } from '../router';
import { page } from './layout';

/** Partie solo : `#/game/<id>`. */
export function playView(root: HTMLElement, [id]: string[]): (() => void) | void {
  const game = getGame(id);
  if (!game || !game.modes.includes('solo')) return navigate('/');
  const content = page(root, game.name);
  return game.mount({
    root: content,
    mode: 'solo',
    me: { id: 'local', name: getSettings().name },
    onExit: () => navigate('/'),
  });
}
