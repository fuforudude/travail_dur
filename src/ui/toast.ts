import { markRead, noteText, onNotifications, unreadCount } from '../net/friends';
import { onPointEvent, onWallet, formatPoints } from '../net/points';
import { navigate } from '../router';
import { h } from './dom';

let box: HTMLElement | null = null;

/** Petite notification en bas d'écran, qui disparaît seule ; avec un bouton, elle reste plus longtemps. */
export function toast(text: string, kind: 'gain' | 'record' | 'info' | 'social' = 'info', action?: { label: string; run(): void }): void {
  if (!box) {
    // Après #panic dans le document : le CSS la masque pendant le faux écran.
    box = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const el = h('div', { class: `toast ${kind}` }, text);
  if (action) {
    const b = h('button', { class: 'toast-action', type: 'button' }, action.label);
    b.addEventListener('click', () => {
      el.remove();
      action.run();
    });
    el.append(b);
  }
  box.append(el);
  const life = action ? 15000 : kind === 'record' ? 5000 : 3200;
  setTimeout(() => el.classList.add('out'), life);
  setTimeout(() => el.remove(), life + 600);
}

/** Amis : chaque notification qui arrive s'affiche, et le bouton du menu porte le nombre de non lues. */
export function initSocialUi(): void {
  onNotifications((_, fresh) => {
    const count = unreadCount();
    document.querySelectorAll<HTMLElement>('.menu-btn').forEach((b) => {
      b.dataset.count = count ? String(count) : '';
    });
    if (!fresh) return;
    if (fresh.kind === 'room_invite' && fresh.room) {
      const room = fresh.room;
      toast(noteText(fresh), 'social', {
        label: 'Rejoindre',
        run: () => {
          void markRead([fresh.id]);
          navigate(`/room/${room}`);
        },
      });
    } else toast(noteText(fresh), 'social', { label: 'Voir', run: () => navigate('/amis/demandes') });
  });
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
