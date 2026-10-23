import { pushKeys } from '../core/input';
import { formatPoints, getWallet, history, milestones, onWallet, SCALE, type Milestone, type PointEvent } from '../net/points';
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
  const goals = h('div', { class: 'pts-goals' });

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
      multiConfigured ? h('div', { class: 'pts-actions' }, shop, roulette, slots) : h('p', { class: 'notice' }, 'Les points ne sont pas disponibles en mode local.'),
      h('h2', {}, 'Comment gagner des points'),
      h('table', { class: 'pts-scale' }, h('tbody', {}, ...SCALE.map(([g, rule]) => h('tr', {}, h('td', {}, g), h('td', {}, rule))))),
      multiConfigured ? h('h2', {}, 'Paliers de fou furieux') : '',
      goals,
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
  const GAMES: Record<Milestone['game'], string> = { '2048': '2048', tetris: 'Tetris', flappy: 'Flappy Bird', td: 'Tower defense', wordle: 'Wordle' };
  const loadGoals = () =>
    milestones()
      .then((all) => {
        const games = [...new Set(all.map((m) => m.game))];
        goals.replaceChildren(
          h('p', { class: 'muted small' }, 'Une prime énorme, une seule fois, quand tu atteins chaque palier.'),
          ...games.map((g) =>
            h(
              'div',
              { class: 'pts-goal-game' },
              h('h3', {}, GAMES[g]),
              h(
                'ul',
                {},
                ...all
                  .filter((m) => m.game === g)
                  .map((m) =>
                    h(
                      'li',
                      { class: m.done ? 'done' : '' },
                      h('span', {}, (m.done ? '✓ ' : '') + m.label),
                      h('span', { class: 'pts-amount push' }, `+${formatPoints(m.reward)}`),
                    ),
                  ),
              ),
            ),
          ),
        );
      })
      .catch(() => goals.replaceChildren()); // migration 0047 pas encore passée
  const load = () =>
    history()
      .then((events) => list.replaceChildren(...(events.length ? events.map(line) : [h('li', { class: 'muted' }, 'Rien pour l’instant.')])))
      .catch((e: Error) => list.replaceChildren(h('li', { class: 'notice' }, e.message)));
  if (multiConfigured) {
    void load();
    void loadGoals();
  } else list.replaceChildren();

  const offWallet = onWallet(() => {
    show();
    void load();
    void loadGoals();
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
