import { h } from './dom';

export interface AutoPlay {
  el: HTMLElement;
  running(): boolean;
  start(n: number): Promise<void>;
  stop(): void;
  /** Grise les boutons « Auto » (pendant un tour lancé à la main). */
  setDisabled(off: boolean): void;
}

/**
 * Enchaînement automatique (caisses, machine à sous, roulette) : des boutons « Auto ×n », puis
 * « Arrêter » pendant que ça tourne. `step` joue un tour et retourne false pour s'arrêter (plus
 * assez de points, erreur du serveur…).
 */
export function autoPlay(counts: number[], step: () => Promise<boolean>, onChange: () => void = () => {}): AutoPlay {
  const el = h('div', { class: 'auto-play' });
  let running = false;
  let left = 0;
  let disabled = false;

  const button = (label: string, onClick: () => void, cls = '') => {
    const b = h('button', { class: `field ${cls}`.trim(), type: 'button', disabled: !running && disabled }, label);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  };
  const render = () => {
    el.replaceChildren(
      ...(running
        ? [button(`Arrêter l’auto (${left} restant${left > 1 ? 's' : ''})`, () => api.stop(), 'auto-stop')]
        : counts.map((n) => button(`Auto ×${n}`, () => void api.start(n)))),
    );
  };

  const api: AutoPlay = {
    el,
    running: () => running,
    async start(n: number) {
      if (running || disabled) return;
      running = true;
      left = n;
      render();
      onChange();
      try {
        while (running && left > 0) {
          left--;
          render();
          if (!(await step())) break;
        }
      } finally {
        running = false;
        left = 0;
        render();
        onChange();
      }
    },
    stop() {
      running = false;
      render();
    },
    setDisabled(off: boolean) {
      if (off === disabled) return;
      disabled = off;
      render();
    },
  };
  render();
  return api;
}
