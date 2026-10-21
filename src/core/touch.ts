// Écrans tactiles : tout le site est piloté au clavier (core/input.ts). Sur téléphone, les boutons
// à l'écran et les glissements simulent simplement les mêmes touches : chaque jeu garde une seule
// logique de commandes.

const coarse = window.matchMedia('(pointer: coarse)');

/** Vrai sur un écran tactile sans souris (téléphone, tablette). */
export const isTouch = () => coarse.matches;

/** Ajoute la classe `touch` sur <html> (le CSS montre alors les commandes tactiles et cache l'aide clavier). */
export function initTouch(): void {
  const apply = () => document.documentElement.classList.toggle('touch', coarse.matches);
  apply();
  coarse.addEventListener('change', apply);
}

/** Simule l'appui d'une touche : passe par la même pile de gestionnaires que le clavier. */
export function pressKey(key: string, opts: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
}

export interface PadKey {
  label: string;
  /** Touche simulée, ou action directe. */
  key: string | (() => void);
  /** Répète tant que le doigt reste appuyé (déplacements). */
  repeat?: boolean;
  /** Prend deux fois plus de place dans sa rangée. */
  wide?: boolean;
  title?: string;
  /** Affiché seulement si vrai au moment du rendu. */
  hidden?: boolean;
}

/** Rangées de gros boutons tactiles (masquées sur ordinateur par le CSS). */
export function touchPad(...rows: PadKey[][]): HTMLElement {
  const pad = document.createElement('div');
  pad.className = 'touch-pad';
  // Les boutons agissent au pointerdown : le clic qui suit ne doit pas atteindre un parent cliquable.
  pad.addEventListener('click', (e) => e.stopPropagation());
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'pad-row';
    for (const k of row) {
      if (k.hidden) continue;
      r.append(padButton(k));
    }
    if (r.childElementCount) pad.append(r);
  }
  return pad;
}

function padButton(k: PadKey): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pad-btn' + (k.wide ? ' wide' : '');
  b.textContent = k.label;
  if (k.title) b.setAttribute('aria-label', k.title);
  const fire = () => (typeof k.key === 'string' ? pressKey(k.key) : k.key());
  let timer = 0;
  const stop = () => {
    clearTimeout(timer);
    clearInterval(timer);
    b.classList.remove('down');
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // pas de focus (Entrée resterait sur le bouton), pas de double-tap zoom
    b.setPointerCapture?.(e.pointerId);
    b.classList.add('down');
    fire();
    if (k.repeat) timer = window.setTimeout(() => (timer = window.setInterval(fire, 70)), 220);
  });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointercancel', stop);
  b.addEventListener('lostpointercapture', stop);
  // Clic clavier ou lecteur d'écran (pas de pointerdown) : une seule action.
  b.addEventListener('click', (e) => {
    if (e.detail === 0) fire();
  });
  return b;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Glissements et appuis courts sur un élément. `move` est appelé pendant le glissement chaque fois
 * que le doigt a parcouru `step` pixels (déplacement continu, Tetris) ; `swipe` une fois à la fin.
 */
export function onGesture(
  el: HTMLElement,
  h: { swipe?: (d: Direction) => void; tap?: (x: number, y: number) => void; move?: (d: Direction) => void; step?: number; min?: number },
): () => void {
  const min = h.min ?? 30;
  let start: { x: number; y: number; t: number; id: number } | null = null;
  let last = { x: 0, y: 0 };
  let moved = false;
  const dir = (dx: number, dy: number): Direction => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    last = { x: e.clientX, y: e.clientY };
    moved = false;
  };
  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    e.preventDefault();
    if (!h.move) return;
    const step = h.step ?? 28;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    if (Math.abs(dx) >= step && Math.abs(dx) > Math.abs(dy)) {
      for (let i = 0; i < Math.floor(Math.abs(dx) / step); i++) h.move(dx > 0 ? 'right' : 'left');
      last = { x: e.clientX, y: last.y };
      moved = true;
    } else if (dy >= step && dy > Math.abs(dx)) {
      for (let i = 0; i < Math.floor(dy / step); i++) h.move('down');
      last = { x: last.x, y: e.clientY };
      moved = true;
    }
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const quick = performance.now() - start.t < 350;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && !moved) h.tap?.(e.clientX, e.clientY);
    else if (h.swipe && Math.max(Math.abs(dx), Math.abs(dy)) >= min && (quick || !h.move)) h.swipe(dir(dx, dy));
    start = null;
  };
  const cancel = () => (start = null);
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move, { passive: false });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}
