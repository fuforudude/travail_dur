import { getSettings } from '../core/settings';
import { formatPoints, getWallet } from '../net/points';
import { navigate } from '../router';
import { h } from './dom';
import { drawerButton } from './drawer';

/** Squelette commun : en-tête discret + zone de contenu. Hors accueil, un bouton ramène à l'accueil. */
export function page(root: HTMLElement, title: string): HTMLElement {
  const content = h('main', { class: 'content' });
  const isHome = title === 'Accueil' || title === 'Bienvenue';
  const home = isHome ? null : h('button', { class: 'home-btn', type: 'button', title: 'Retour à l’accueil' }, '← Accueil');
  home?.addEventListener('click', () => navigate('/'));
  // La souris ne doit pas laisser le focus sur le bouton (Entrée y renverrait à l'accueil en plein jeu).
  home?.addEventListener('mousedown', (e) => e.preventDefault());
  root.append(
    h(
      'header',
      { class: 'topbar' },
      title === 'Bienvenue' ? null : drawerButton(),
      home,
      h('a', { class: 'brand', href: '#/' }, 'Notes'),
      h('span', { class: 'crumb' }, title),
      pointsBadge(),
      h('span', { class: 'who' }, getSettings().name),
    ),
    content,
  );
  return content;
}

/** Solde de points dans la barre du haut (mis à jour par ui/toast.ts) ; un clic ouvre la page Points. */
function pointsBadge(): HTMLElement {
  const w = getWallet();
  const b = h('button', { class: 'points-badge', type: 'button', title: 'Mes points', hidden: !w }, w ? `◆ ${formatPoints(w.balance)}` : '');
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => navigate('/points'));
  return b;
}
