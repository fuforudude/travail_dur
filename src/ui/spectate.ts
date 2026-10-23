import { pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { ensureAccount } from '../net/auth';
import { friendList } from '../net/friends';
import { formatPoints } from '../net/points';
import { playerName, recentSpins, watchSpins, type Spin } from '../net/spectate';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';
import { colorName, colorOf, WHEEL, wheelSvg } from './roulette';
import { SYMBOLS } from './slots';

const BET_NAMES: Record<string, string> = {
  red: 'Rouge', black: 'Noir', even: 'Pair', odd: 'Impair', low: '1 – 18', high: '19 – 36', d1: '1 – 12', d2: '13 – 24', d3: '25 – 36',
};
const betName = (k: string) => BET_NAMES[k] ?? k.slice(1);
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function outcome(s: Spin): string {
  const net = s.payout - s.stake;
  const what = s.game === 'roulette' ? `${s.detail.number} ${colorName(s.detail.number ?? 0)}` : (s.detail.reels ?? []).map((r) => SYMBOLS[r]).join(' ');
  return `${what} : ${s.payout ? `gagné ${formatPoints(s.payout)} (${net >= 0 ? '+' : ''}${formatPoints(net)})` : `perdu ${formatPoints(s.stake)}`}`;
}

/** `#/regarder/<id>` : la roulette et la machine à sous d'un ami, en direct. */
export function spectateView(root: HTMLElement, [uid]: string[]): () => void {
  const content = page(root, 'Regarder');
  const title = h('h1', {}, 'Casino');
  const live = h('p', { class: 'muted small sp-live' }, 'Connexion…');
  const balanceEl = h('span', { class: 'stat' });
  const status = h('p', { class: 'status sp-status' }, 'En attente de son prochain tour…');
  const svg = wheelSvg();
  const result = h('div', { class: 'rl-result' }, '–');
  const reels = [4, 5, 3].map((s) => h('div', { class: 'sl-reel' }, h('span', {}, SYMBOLS[s])));
  const roulettePane = h('div', { class: 'sp-pane' }, h('h2', {}, 'Roulette'), h('div', { class: 'rl-wheel-wrap' }, h('div', { class: 'rl-pointer' }), svg), result);
  const slotsPane = h('div', { class: 'sp-pane' }, h('h2', {}, 'Machine à sous'), h('div', { class: 'sl-window' }, ...reels));
  const list = h('ol', { class: 'pts-history' });
  content.append(
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'pts-head' }, h('div', {}, title, live), balanceEl),
      status,
      h('div', { class: 'sp-stage' }, roulettePane, slotsPane),
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

  let disposed = false;
  let rotation = 0;
  const history: Spin[] = [];
  const queue: Spin[] = [];
  let playing = false;

  const renderList = () =>
    list.replaceChildren(
      ...(history.length
        ? history.map((s) =>
            h(
              'li',
              { class: 'ev-casino' },
              h('span', { class: 'pts-amount' + (s.payout - s.stake < 0 ? ' neg' : '') }, (s.payout - s.stake > 0 ? '+' : '') + formatPoints(s.payout - s.stake)),
              h('span', {}, `${s.game === 'roulette' ? 'Roulette' : 'Machine à sous'} · ${outcome(s)}`),
              h('span', { class: 'muted small push' }, new Date(s.created_at).toLocaleTimeString('fr-FR', { timeStyle: 'short' })),
            ),
          )
        : [h('li', { class: 'muted' }, 'Aucun tour dans la dernière heure.')]),
    );

  const showBalance = (s: Spin) => balanceEl.replaceChildren('Solde ', h('b', {}, formatPoints(s.balance)));

  const play = async (s: Spin, fast: boolean) => {
    const pane = s.game === 'roulette' ? roulettePane : slotsPane;
    pane.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    roulettePane.classList.toggle('on', s.game === 'roulette');
    slotsPane.classList.toggle('on', s.game === 'slots');
    if (s.game === 'roulette') {
      const bets = Object.entries(s.detail.bets ?? {}).map(([k, v]) => `${betName(k)} ${formatPoints(v)}`).join(' · ');
      status.textContent = `Mise ${formatPoints(s.stake)} : ${bets}. Rien ne va plus…`;
      const index = WHEEL.indexOf(s.detail.number ?? 0);
      const target = -(index * 360) / WHEEL.length;
      const current = ((rotation % 360) + 360) % 360;
      rotation += 360 * 5 + ((target - current + 720) % 360);
      svg.style.transitionDuration = fast ? '1.3s' : '';
      svg.style.transform = `rotate(${rotation}deg)`;
      result.textContent = '…';
      result.className = 'rl-result';
      await wait(fast ? 1400 : 3600);
      result.textContent = String(s.detail.number);
      result.className = `rl-result ${colorOf(s.detail.number ?? 0)}`;
    } else {
      status.textContent = `Mise ${formatPoints(s.stake)}…`;
      reels.forEach((el) => el.classList.remove('win'));
      const rolling = reels.map((el, i) => {
        el.classList.add('spin');
        let k = i * 2;
        return window.setInterval(() => (el.firstElementChild!.textContent = SYMBOLS[k++ % SYMBOLS.length]), 70);
      });
      const r = s.detail.reels ?? [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        await wait(fast ? (i === 0 ? 250 : 150) : i === 0 ? 700 : 450);
        clearInterval(rolling[i]);
        reels[i].classList.remove('spin');
        reels[i].firstElementChild!.textContent = SYMBOLS[r[i]];
      }
      reels.forEach((el) => el.classList.toggle('win', s.payout > 0));
    }
    status.textContent = `${s.game === 'roulette' ? 'Roulette' : 'Machine à sous'} · ${outcome(s)}${s.payout === 0 && s.balance === 0 ? ' · tout perdu 💀' : ''}`;
    if (s.payout) blip(s.payout / s.stake >= 36 ? 1200 : 880);
    showBalance(s);
    history.unshift(s);
    history.splice(10);
    renderList();
  };

  const next = async () => {
    if (playing) return;
    playing = true;
    while (queue.length && !disposed) {
      const s = queue.shift()!;
      await play(s, queue.length > 0); // du retard (mode auto) : animations accélérées
      await wait(queue.length ? 300 : 0);
    }
    playing = false;
  };

  let stop = () => {};
  void (async () => {
    const [me, name] = await Promise.all([ensureAccount(), playerName(uid)]);
    if (disposed) return;
    title.textContent = `Casino de ${name}`;
    const allowed = me?.id === uid || (await friendList().catch(() => [])).some((f) => f.id === uid && f.status === 'friend');
    if (disposed) return;
    if (!allowed) {
      live.textContent = `Tu ne peux regarder que tes amis : ajoute ${name} en ami d’abord.`;
      status.textContent = '';
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
    stop = watchSpins(uid, (s) => {
      queue.push(s);
      void next();
    });
  })();

  return () => {
    disposed = true;
    stop();
    offKeys();
  };
}
