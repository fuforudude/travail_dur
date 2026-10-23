import { pushKeys } from '../core/input';
import { getSettings } from '../core/settings';
import { getAccount, signOut } from '../net/auth';
import { adminKnown } from '../net/admin';
import { unreadCount } from '../net/friends';
import { onlinePlayers } from '../net/online';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h } from './dom';

interface Entry {
  icon: string;
  label: string;
  action: () => void | Promise<void>;
  hidden?: boolean;
  danger?: boolean;
}

let open: (() => void) | null = null; // fermeture du menu actuellement ouvert

/** Ouvre le menu latéral (s'il est déjà ouvert, le referme). */
export function toggleDrawer(): void {
  if (open) return open();

  const account = getAccount();
  let confirmLogout = false;

  const entries = (): Entry[] => [
    { icon: '⌂', label: 'Accueil', action: () => navigate('/') },
    { icon: '★', label: 'Classements', action: () => navigate('/scores'), hidden: !multiConfigured },
    { icon: '◆', label: 'Points et casino', action: () => navigate('/points'), hidden: !multiConfigured },
    { icon: '✦', label: 'Boutique', action: () => navigate('/shop'), hidden: !multiConfigured },
    { icon: '●', label: onlinePlayers().length ? `En ligne (${onlinePlayers().length})` : 'En ligne', action: () => navigate('/en-ligne'), hidden: !multiConfigured },
    { icon: '♥', label: unreadCount() ? `Amis (${unreadCount()})` : 'Amis', action: () => navigate('/amis'), hidden: !multiConfigured },
    { icon: '⌂', label: 'Mon appart', action: () => navigate('/appart'), hidden: !multiConfigured },
    // Réservé aux admins (le serveur refuse de toute façon aux autres).
    { icon: '⚑', label: 'Admin', action: () => navigate('/admin'), hidden: !adminKnown() },
    { icon: '⚙', label: 'Réglages', action: () => navigate('/settings') },
    {
      icon: '@',
      label: account?.verified ? 'Mon compte' : 'Ajouter un email',
      action: () => navigate('/account'),
      hidden: !multiConfigured,
    },
    {
      icon: '⇥',
      label: confirmLogout ? 'Confirmer la déconnexion' : 'Se déconnecter',
      danger: true,
      // Un compte invité n'a aucun moyen d'être retrouvé : on ne propose pas de le quitter.
      hidden: !multiConfigured || !account?.verified,
      action: async () => {
        if (!confirmLogout) {
          confirmLogout = true;
          return renderList(true);
        }
        close();
        await signOut();
        navigate('/');
      },
    },
  ];

  const list = h('nav', { class: 'drawer-list' });
  const panel = h(
    'aside',
    { class: 'drawer', role: 'dialog', 'aria-label': 'Menu' },
    h(
      'div',
      { class: 'drawer-head' },
      h('span', { class: 'drawer-avatar' }, (getSettings().name[0] ?? '?').toUpperCase()),
      h(
        'div',
        {},
        h('div', { class: 'drawer-name' }, getSettings().name),
        h('div', { class: 'muted small' }, !multiConfigured ? 'Hors ligne' : account?.verified ? `Compte vérifié · ${account.email ?? ''}` : 'Compte invité'),
      ),
    ),
    list,
    h('p', { class: 'drawer-foot muted small keyboard-only' }, '↑ ↓ choisir · Entrée ouvrir · M fermer'),
  );
  const backdrop = h('div', { class: 'drawer-backdrop' });
  // Dans #app (et non body) : la touche panique, qui masque #app, masque aussi le menu.
  document.getElementById('app')!.append(backdrop, panel);
  requestAnimationFrame(() => {
    backdrop.classList.add('on');
    panel.classList.add('on');
  });

  function renderList(keepFocus = false) {
    const index = keepFocus ? [...list.children].indexOf(document.activeElement as Element) : 0;
    list.replaceChildren(
      ...entries()
        .filter((e) => !e.hidden)
        .map((e) => {
          const b = h('button', { class: 'drawer-item' + (e.danger ? ' danger' : ''), type: 'button' }, h('span', { class: 'drawer-icon' }, e.icon), e.label);
          b.addEventListener('click', () => {
            const r = e.action();
            if (!e.danger) close();
            return r;
          });
          return b;
        }),
    );
    (list.children[Math.max(0, index)] as HTMLElement | undefined)?.focus();
  }
  renderList();

  const previous = document.activeElement as HTMLElement | null;
  const popKeys = pushKeys((e) => {
    const items = [...list.querySelectorAll<HTMLElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === 'Backspace' || e.key.toLowerCase() === 'm') {
      e.preventDefault();
      close();
    }
    // Entrée active le bouton qui a le focus (comportement natif).
  });

  const onHash = () => close();
  window.addEventListener('hashchange', onHash);
  backdrop.addEventListener('click', () => close());

  function close() {
    if (open !== close) return;
    open = null;
    popKeys();
    window.removeEventListener('hashchange', onHash);
    backdrop.classList.remove('on');
    panel.classList.remove('on');
    setTimeout(() => {
      backdrop.remove();
      panel.remove();
    }, 160);
    if (previous?.isConnected) previous.focus();
  }
  open = close;
}

/** Bouton ☰ de la barre du haut. */
export function drawerButton(): HTMLElement {
  const b = h('button', { class: 'menu-btn', type: 'button', title: 'Menu', 'aria-label': 'Menu' }, h('span'), h('span'), h('span'));
  b.dataset.count = unreadCount() ? String(unreadCount()) : '';
  b.addEventListener('mousedown', (e) => e.preventDefault()); // ne pas garder le focus (Entrée en jeu)
  b.addEventListener('click', () => toggleDrawer());
  return b;
}
