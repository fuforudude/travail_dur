import { getSettings } from '../core/settings';
import { getGame } from '../games/registry';
import { navigate } from '../router';
import { h } from './dom';
import { page } from './layout';

/** Partie solo : `#/game/<id>`. Le code du jeu est téléchargé à l'ouverture. */
export function playView(root: HTMLElement, [id]: string[]): (() => void) | void {
  const info = getGame(id);
  if (!info || !info.modes.includes('solo')) return navigate('/');
  const content = page(root, info.name);
  const loading = h('p', { class: 'muted' }, 'Chargement…');
  content.append(loading);
  let unmount: (() => void) | null = null;
  let disposed = false;
  info.load().then(
    (game) => {
      if (disposed) return;
      loading.remove();
      unmount = game.mount({
        root: content,
        mode: 'solo',
        me: { id: 'local', name: getSettings().name },
        onExit: () => navigate('/'),
      });
    },
    (e: Error) => (loading.textContent = `Chargement impossible : ${e.message}`),
  );
  return () => {
    disposed = true;
    unmount?.();
  };
}
