import { pushKeys } from '../core/input';
import { formatPoints, getWallet, history, onWallet, SCALE, SCALE_NOTES, type PointEvent } from '../net/points';
import { itemById } from '../net/shop';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

/** `#/points` : solde, barème, historique. */
export function pointsView(root: HTMLElement): () => void {
  const content = page(root, 'Points');
  const balance = h('span', { class: 'pts-balance' }, '…');
  const earned = h('span', { class: 'muted small' });
  const list = h('ol', { class: 'pts-history' }, h('li', { class: 'muted' }, 'Chargement…'));

  const roulette = h('button', { class: 'field', type: 'button' }, 'Roulette');
  roulette.addEventListener('click', () => navigate('/roulette'));
  const slots = h('button', { class: 'field', type: 'button' }, 'Machine à sous');
  slots.addEventListener('click', () => navigate('/slots'));
  const shop = h('button', { class: 'field', type: 'button' }, 'Boutique');
  shop.addEventListener('click', () => navigate('/shop'));

  const show = () => {
    const w = getWallet();
    balance.textContent = w ? `◆ ${formatPoints(w.balance)}` : multiConfigured ? '…' : '—';
    earned.textContent = w ? `${formatPoints(w.earned)} gagnés en jouant` : '';
  };
  show();

  content.append(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'pts-head' }, h('div', {}, h('h1', {}, 'Mes points'), earned), balance),
      multiConfigured ? h('div', { class: 'pts-actions' }, shop, roulette, slots) : h('p', { class: 'notice' }, 'Le serveur n’est pas configuré : pas de points.'),
      h('h2', {}, 'Comment gagner des points'),
      h('table', { class: 'pts-scale' }, h('tbody', {}, ...SCALE.map(([g, rule]) => h('tr', {}, h('td', {}, g), h('td', {}, rule))))),
      ...SCALE_NOTES.map((n) => h('p', { class: 'muted small' }, n)),
      h('h2', {}, 'Derniers mouvements'),
      list,
    ),
    hints(['B', 'boutique'], ['R', 'roulette'], ['M', 'machine à sous'], ['Retour arrière', 'accueil']),
  );

  const line = (e: PointEvent) =>
    h(
      'li',
      { class: `ev-${e.kind}` },
      h('span', { class: 'pts-amount' + (e.amount < 0 ? ' neg' : '') }, (e.amount > 0 ? '+' : '') + formatPoints(e.amount)),
      h('span', {}, e.reason.replace(/^Boutique : (.+)$/, (_, id: string) => `Boutique : ${itemById(id)?.name ?? id}`)),
      h('span', { class: 'muted small push' }, new Date(e.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })),
    );
  const load = () =>
    history()
      .then((events) => list.replaceChildren(...(events.length ? events.map(line) : [h('li', { class: 'muted' }, 'Rien pour l’instant.')])))
      .catch((e: Error) => list.replaceChildren(h('li', { class: 'notice' }, e.message)));
  if (multiConfigured) void load();
  else list.replaceChildren();

  const offWallet = onWallet(() => {
    show();
    void load();
  });
  const offKeys = pushKeys((e) => {
    const key = e.key.toLowerCase();
    if (key === 'b' && multiConfigured) navigate('/shop');
    else if (key === 'r' && multiConfigured) navigate('/roulette');
    else if (key === 'm' && multiConfigured) navigate('/slots');
    else if (key === 'backspace') {
      e.preventDefault();
      navigate('/');
    }
  });
  return () => {
    offWallet();
    offKeys();
  };
}
