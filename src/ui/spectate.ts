import { pushKeys } from '../core/input';
import { formatPoints } from '../net/points';
import { canWatch, playerName, recentSpins, watchSpins, type Spin } from '../net/spectate';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { openDock } from './spectateDock';
import { net, outcome, signed, spinStage } from './spinStage';

/** `#/regarder/<id>` : la roulette et la machine à sous d'un ami, en direct. */
export function spectateView(root: HTMLElement, [uid]: string[]): () => void {
  const content = page(root, 'Regarder');
  const title = h('h1', {}, 'Casino');
  const live = h('p', { class: 'muted small sp-live' }, 'Connexion…');
  const balanceEl = h('span', { class: 'stat' });
  const side = h('button', { class: 'field small-btn', type: 'button', hidden: true }, '◱ Garder sur le côté');
  side.addEventListener('click', () => {
    openDock(uid);
    navigate('/');
  });
  const list = h('ol', { class: 'pts-history' });
  const history: Spin[] = [];
  const showBalance = (s: Spin) => balanceEl.replaceChildren('Solde ', h('b', {}, formatPoints(s.balance)));
  const stage = spinStage({
    sound: true,
    onStart: (s) => (s.game === 'roulette' ? stage.roulette : stage.slots).scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    onPlayed: (s) => {
      showBalance(s);
      history.unshift(s);
      history.splice(10);
      renderList();
    },
  });
  content.append(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'pts-head' }, h('div', {}, title, live, side), balanceEl),
      stage.status,
      h('div', { class: 'sp-stage' }, stage.roulette, stage.slots),
      h('h2', {}, 'Derniers tours'),
      list,
    ),
    hints(['Retour arrière', 'amis']),
  );
  const offKeys = pushKeys((e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      navigate('/amis');
    }
  });
  if (!multiConfigured) {
    live.textContent = 'Pas disponible en mode local.';
    return offKeys;
  }

  const renderList = () =>
    list.replaceChildren(
      ...(history.length
        ? history.map((s) =>
            h(
              'li',
              { class: 'ev-casino' },
              h('span', { class: 'pts-amount' + (net(s) < 0 ? ' neg' : '') }, signed(net(s))),
              h('span', {}, `${s.game === 'roulette' ? 'Roulette' : 'Machine à sous'} · ${outcome(s)}`),
              h('span', { class: 'muted small push' }, new Date(s.created_at).toLocaleTimeString('fr-FR', { timeStyle: 'short' })),
            ),
          )
        : [h('li', { class: 'muted' }, 'Aucun tour dans la dernière heure.')]),
    );

  let disposed = false;
  let stop = () => {};
  void (async () => {
    const [allowed, name] = await Promise.all([canWatch(uid), playerName(uid)]);
    if (disposed) return;
    title.textContent = `Casino de ${name}`;
    if (!allowed) {
      live.textContent = `Tu ne peux regarder que tes amis : ajoute ${name} en ami d’abord.`;
      stage.status.textContent = '';
      renderList();
      return;
    }
    try {
      history.push(...(await recentSpins(uid)));
    } catch (e) {
      live.textContent = (e as Error).message;
      return;
    }
    if (disposed) return;
    if (history[0]) showBalance(history[0]);
    renderList();
    live.replaceChildren(h('span', { class: 'sp-dot' }), ' En direct : chaque tour apparaît ici au moment où il le lance.');
    side.hidden = false;
    stop = watchSpins(uid, (s) => stage.push(s));
  })();

  return () => {
    disposed = true;
    stop();
    stage.dispose();
    offKeys();
  };
}
