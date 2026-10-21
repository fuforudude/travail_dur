// Ouverture d'une caisse en plein écran, commune aux caisses de meubles et du tower defense :
// le bandeau qui défile (façon caisse de CS:GO), l'objet gagné, « Rouvrir » et l'ouverture auto.

import { pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { holdWallet, refreshWallet } from '../net/points';
import { autoPlay } from './autoplay';
import { h } from './dom';
import './crateOpening.css';

const REEL_LENGTH = 48;
const WIN_INDEX = 42; // case qui s'arrête sous le repère
const AUTO_COUNTS = [5, 10, 25];

export interface CrateDraw {
  /** Classe de rareté de l'objet gagné (rar-…). */
  rarity: string;
  /** Contenu de la révélation (rareté, aperçu, nom, explication). */
  reveal: (HTMLElement | string)[];
  /** Petite case pour le récapitulatif de l'ouverture auto. */
  chip: HTMLElement;
  /** Gros lot : son plus aigu. */
  jackpot: boolean;
  /** Case du bandeau pour l'objet gagné. */
  cell: HTMLElement;
}

export interface CrateStageOptions {
  title: string;
  /** Texte du bouton pour rouvrir (« Rouvrir · ◆ 500 »). */
  again: () => string;
  /** Tire la caisse sur le serveur. Lève une erreur pour s'arrêter (plus assez de points, caisse complète…). */
  draw: () => Promise<CrateDraw>;
  /** Case du bandeau tirée au hasard (pour le décor). */
  filler: () => HTMLElement;
  /** Appelé après chaque ouverture réussie (mise à jour de la page dessous). */
  onOpened?: () => void;
}

/** Ouvre la caisse en plein écran ; se ferme avec Retour arrière ou le bouton Fermer (Échap est la touche panique). */
export function openCrateStage(o: CrateStageOptions): void {
  let closed = false;
  let busy = false;
  const haul: HTMLElement[] = [];

  const status = h('p', { class: 'status' });
  const track = h('div', { class: 'cr-track' });
  const reel = h('div', { class: 'cr-reel' }, h('div', { class: 'cr-marker' }), track);
  const reveal = h('div', { class: 'cr-reveal', hidden: true });
  const haulEl = h('div', { class: 'cr-haul', hidden: true });
  const againBtn = h('button', { class: 'field rl-spin', type: 'button' });
  const closeBtn = h('button', { class: 'field', type: 'button' }, 'Fermer', h('span', { class: 'keyboard-only' }, ' (Retour arrière)'));
  const auto = autoPlay(AUTO_COUNTS, () => once(true), () => render());
  const stage = h(
    'div',
    { class: 'cr-stage', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
    h(
      'div',
      { class: 'cr-stage-inner' },
      h('h1', {}, o.title),
      reel,
      reveal,
      status,
      h('div', { class: 'cr-stage-actions' }, againBtn, auto.el, closeBtn),
      haulEl,
    ),
  );

  const render = () => {
    againBtn.textContent = o.again();
    againBtn.append(Object.assign(document.createElement('span'), { className: 'keyboard-only', textContent: ' (Entrée)' }));
    againBtn.disabled = busy || auto.running();
    auto.setDisabled(busy && !auto.running());
    haulEl.hidden = !haul.length;
    if (haul.length) haulEl.replaceChildren(h('p', { class: 'muted small' }, `Obtenu (${haul.length}) :`), h('div', { class: 'cr-haul-list' }, ...haul));
  };

  /** Une ouverture : tirage, bandeau, révélation. Retourne false en cas d'échec. */
  const once = async (fast: boolean): Promise<boolean> => {
    if (closed || busy) return false;
    busy = true;
    status.textContent = 'Ouverture…';
    render();
    const release = holdWallet();
    try {
      const r = await o.draw();
      if (closed) return false;
      reveal.hidden = true;
      const cells = Array.from({ length: REEL_LENGTH }, (_, i) => (i === WIN_INDEX ? r.cell : o.filler()));
      track.replaceChildren(...cells);
      track.style.transition = 'none';
      track.style.transform = 'translateX(0)';
      void track.offsetWidth; // repart de zéro
      const cellWidth = (track.firstElementChild as HTMLElement).offsetWidth + 6;
      const jitter = (Math.random() - 0.5) * cellWidth * 0.7; // ne s'arrête pas toujours pile au milieu
      const target = WIN_INDEX * cellWidth + cellWidth / 2 - reel.clientWidth / 2 + jitter;
      const duration = fast ? 1.8 : 5.5;
      track.style.transition = `transform ${duration}s cubic-bezier(0.08, 0.6, 0.12, 1)`;
      track.style.transform = `translateX(${-target}px)`;
      // Petit « tic » à chaque case qui passe sous le repère.
      let last = -1;
      const tick = window.setInterval(() => {
        const x = -new DOMMatrix(getComputedStyle(track).transform).m41 + reel.clientWidth / 2;
        const i = Math.floor(x / cellWidth);
        if (i !== last) {
          last = i;
          blip(900, 0.02);
        }
      }, 30);
      await new Promise((ok) => setTimeout(ok, duration * 1000 + 200));
      clearInterval(tick);
      if (closed) return false;
      reveal.className = `cr-reveal ${r.rarity}`;
      reveal.replaceChildren(...r.reveal);
      reveal.hidden = false;
      haul.unshift(r.chip);
      blip(r.jackpot ? 1320 : 660);
      status.textContent = '';
      o.onOpened?.();
      return true;
    } catch (e) {
      status.textContent = (e as Error).message;
      return false;
    } finally {
      release();
      void refreshWallet();
      busy = false;
      if (!closed) render();
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    auto.stop();
    offKeys();
    stage.remove();
    document.body.classList.remove('cr-stage-open');
  };

  againBtn.addEventListener('click', () => void once(false));
  closeBtn.addEventListener('click', close);
  const offKeys = pushKeys((e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      close();
    } else if ((e.key === 'Enter' || e.key === ' ') && !auto.running()) {
      e.preventDefault();
      void once(false);
    }
  });

  document.body.append(stage);
  document.body.classList.add('cr-stage-open');
  render();
  void once(false);
}
