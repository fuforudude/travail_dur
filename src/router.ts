// Routage par hash, compatible GitHub Pages sans configuration serveur.
import { isStale } from './core/update';

export type Cleanup = () => void;
export type View = (root: HTMLElement, params: string[]) => Cleanup | void;

interface Route {
  pattern: RegExp;
  view: View;
}

const routes: Route[] = [];
let cleanup: Cleanup | void;

export function route(pattern: RegExp, view: View): void {
  routes.push({ pattern, view });
}

/**
 * Vue chargée à la demande : son code n'est téléchargé qu'à la première visite de la page.
 * Si on change de page avant la fin du chargement, elle n'est jamais affichée.
 */
const loaders: (() => Promise<View>)[] = [];

export function lazy(load: () => Promise<View>): View {
  let pending: Promise<View> | null = null;
  const get = () => (pending ??= load().catch((e) => ((pending = null), Promise.reject(e))));
  loaders.push(get);
  return (root, params) => {
    let disposed = false;
    let inner: Cleanup | void;
    get().then(
      (view) => {
        if (!disposed) inner = view(root, params);
      },
      () => {
        if (!disposed) root.textContent = 'Chargement impossible : vérifie la connexion puis recharge la page.';
      },
    );
    return () => {
      disposed = true;
      inner?.();
    };
  };
}

/** Télécharge en arrière-plan le code des autres pages, pour qu'elles s'ouvrent ensuite sans attendre. */
export function prefetchViews(): void {
  for (const get of loaders) void get().catch(() => {});
}

export function navigate(path: string): void {
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

export function currentPath(): string {
  return location.hash.replace(/^#/, '') || '/';
}

function render(): void {
  const root = document.getElementById('app')!;
  cleanup?.();
  cleanup = undefined;
  root.replaceChildren();
  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      cleanup = r.view(root, m.slice(1).map(decodeURIComponent));
      return;
    }
  }
  navigate('/');
}

export function startRouter(): void {
  // Nouvelle version en ligne : on la charge au changement de page (jamais au milieu d'une page).
  window.addEventListener('hashchange', () => (isStale() ? location.reload() : render()));
  render();
}
