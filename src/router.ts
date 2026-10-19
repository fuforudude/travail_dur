// Routage par hash, compatible GitHub Pages sans configuration serveur.
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
  window.addEventListener('hashchange', render);
  render();
}
