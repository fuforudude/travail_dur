import { onPointEvent, onWallet, formatPoints } from '../net/points';
import { h } from './dom';

let box: HTMLElement | null = null;

/** Petite notification en bas d'écran, qui disparaît seule. */
export function toast(text: string, kind: 'gain' | 'record' | 'info' = 'info'): void {
  if (!box) {
    // Après #panic dans le document : le CSS la masque pendant le faux écran.
    box = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('div', { class: `toast ${kind}` }, text);
  box.append(el);
  setTimeout(() => el.classList.add('out'), kind === 'record' ? 5000 : 3200);
  setTimeout(() => el.remove(), kind === 'record' ? 5600 : 3800);
}

/** Notifie chaque gain de points, et tient à jour les compteurs affichés dans la barre du haut. */
export function initPointsUi(): void {
  onPointEvent((e) => {
    if (e.kind === 'casino' || e.amount <= 0) return; // le casino affiche lui-même ses résultats
    toast(`+${formatPoints(e.amount)} points · ${e.reason}`, e.kind === 'record' ? 'record' : 'gain');
  });
  onWallet((w) => {
    document.querySelectorAll<HTMLElement>('.points-badge').forEach((el) => {
      el.hidden = !w;
      el.textContent = w ? `◆ ${formatPoints(w.balance)}` : '';
    });
  });
}
