import { togglePanic } from '../core/panic';
import { getSettings } from '../core/settings';
import { getAccount, onAccount } from '../net/auth';
import { nameEl } from '../net/cosmetics';
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
      whoEl(),
      panicButton(),
    ),
    content,
  );
  return content;
}

/** Sur téléphone (pas de touche Échap) : le bouton panique, d'apparence anodine. Un appui long sur l'écran de secours ramène au jeu. */
function panicButton(): HTMLElement {
  const b = h('button', { class: 'panic-btn touch-only', type: 'button', 'aria-label': 'Notes' });
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    togglePanic();
  });
  return b;
}

/** Solde de points dans la barre du haut (mis à jour par ui/toast.ts) ; un clic ouvre la page Points. */
function pointsBadge(): HTMLElement {
  const w = getWallet();
  const b = h('button', { class: 'points-badge', type: 'button', title: 'Mes points', hidden: !w }, w ? `◆ ${formatPoints(w.balance)}` : '');
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => navigate('/points'));
  return b;
}

/** Mon pseudo, décoré dès que le compte est connu (il peut arriver après l'affichage de la page). */
function whoEl(): HTMLElement {
  const el = h('span', { class: 'who' }, nameEl(getAccount()?.id, getSettings().name));
  if (!getAccount()) {
    // La session est d'abord annoncée vide, puis avec le compte : on attend ce dernier.
    const off = onAccount((a) => {
      if (!a) return;
      off();
      el.replaceChildren(nameEl(a.id, getSettings().name));
    });
  }
  return el;
}
