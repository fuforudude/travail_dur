// Gestion clavier centralisée : un seul écouteur, une pile de gestionnaires.
// Seul le gestionnaire au sommet de la pile reçoit les touches.
export type KeyHandler = (e: KeyboardEvent) => void;

const stack: KeyHandler[] = [];
let capture: ((e: KeyboardEvent) => void) | null = null;
let interceptor: ((e: KeyboardEvent) => boolean) | null = null;

export function pushKeys(handler: KeyHandler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** La prochaine touche est remise à `cb` sans autre traitement (réglage de la touche panique). */
export function captureNextKey(cb: (e: KeyboardEvent) => void): void {
  capture = cb;
}

/** Filtre prioritaire (touche panique). Retourne true si la touche est consommée. */
export function setInterceptor(fn: (e: KeyboardEvent) => boolean): void {
  interceptor = fn;
}

/** Vrai si l'utilisateur tape dans un champ de saisie. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

window.addEventListener(
  'keydown',
  (e) => {
    if (capture) {
      const cb = capture;
      capture = null;
      e.preventDefault();
      e.stopPropagation();
      cb(e);
      return;
    }
    if (interceptor?.(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    stack[stack.length - 1]?.(e);
  },
  true,
);
