import { isTyping, pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { formatPoints, getWallet, holdWallet, onWallet, spinSlots } from '../net/points';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { autoPlay } from './autoplay';
import { h, hints } from './dom';
import { page } from './layout';

// Doit rester identique à public.casino_slots (0007_points_casino.sql).
export const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '7'];
export const NAMES = ['cerise', 'citron', 'cloche', 'étoile', 'diamant', 'sept'];
export const WEIGHTS = [10, 8, 6, 4, 3, 1]; // sur 32, pour chaque rouleau
export const TRIPLE = [5, 9, 18, 36, 75, 400]; // gain × la mise pour trois symboles identiques
export const TWO_CHERRIES = 2;
const BETS = [1, 5, 10, 25, 50, 100, 250, 500];

/** Retour moyen au joueur (≈ 95,9 %), calculé à partir des poids et des gains. */
export function returnToPlayer(): number {
  const p = WEIGHTS.map((w) => w / 32);
  const triples = p.reduce((sum, x, i) => sum + x ** 3 * TRIPLE[i], 0);
  return triples + 3 * p[0] ** 2 * (1 - p[0]) * TWO_CHERRIES;
}

export function slotsView(root: HTMLElement): () => void {
  const content = page(root, 'Machine à sous');
  if (!multiConfigured) {
    content.append(h('div', { class: 'card narrow' }, h('h1', {}, 'Machine à sous'), h('p', { class: 'muted' }, 'Le serveur n’est pas configuré : pas de points à miser.')));
    return pushKeys((e) => e.key === 'Backspace' && navigate('/'));
  }

  let bet = 2; // index dans BETS
  let spinning = false;
  let message = 'Choisis ta mise (← →), puis Espace.';
  const timers: number[] = [];

  const reels = [0, 1, 2].map((i) => h('div', { class: 'sl-reel' }, h('span', {}, SYMBOLS[[4, 5, 3][i]])));
  const betEl = h('div', { class: 'sl-bet' });
  const status = h('p', { class: 'status' });
  const balanceEl = h('span', { class: 'stat' });
  const lever = h('button', { class: 'field rl-spin', type: 'button' }, 'Jouer (Espace)');
  lever.addEventListener('mousedown', (e) => e.preventDefault());
  lever.addEventListener('click', () => void spin());
  // Ouverture auto : la même mise, n fois de suite (rouleaux plus rapides), bilan affiché.
  let autoNet = 0;
  let autoSpins = 0;
  const auto = autoPlay([10, 25, 50, 100], () => spin(true), () => {
    if (auto.running()) {
      autoNet = 0;
      autoSpins = 0;
    }
    render();
  });
  const table = h(
    'table',
    { class: 'pts-scale sl-pay' },
    h(
      'tbody',
      {},
      ...SYMBOLS.map((s, i) => [s, i] as const)
        .reverse()
        .map(([s, i]) => h('tr', {}, h('td', { class: 'sl-sym' }, `${s} ${s} ${s}`), h('td', {}, `× ${TRIPLE[i]}`))),
      h('tr', {}, h('td', { class: 'sl-sym' }, '🍒 🍒 ·'), h('td', {}, `× ${TWO_CHERRIES}`)),
    ),
  );

  content.append(
    h(
      'div',
      { class: 'game' },
      h('div', { class: 'game-bar' }, balanceEl),
      h('div', { class: 'sl-machine' }, h('div', { class: 'sl-window' }, ...reels), betEl, lever, auto.el),
      status,
      h('div', { class: 'card sl-paycard' }, h('h2', {}, 'Gains'), table, h('p', { class: 'muted small' }, `Gain = mise × multiplicateur. Retour moyen : ${(returnToPlayer() * 100).toFixed(1)} %.`)),
      hints(['← →', 'mise'], ['Espace', 'jouer'], ['S', 'arrêter l’auto'], ['Retour arrière', 'quitter']),
    ),
  );

  const render = () => {
    const w = getWallet();
    balanceEl.replaceChildren('Solde ', h('b', {}, w ? formatPoints(w.balance) : '…'));
    betEl.replaceChildren(
      ...BETS.map((v, i) => {
        const b = h('button', { class: 'rl-token' + (i === bet ? ' on' : ''), type: 'button' }, String(v));
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          bet = i;
          render();
        });
        return b;
      }),
    );
    lever.disabled = spinning || auto.running();
    auto.setDisabled(spinning && !auto.running());
    status.textContent = autoSpins ? `${message} · Auto : ${autoSpins} tour${autoSpins > 1 ? 's' : ''}, bilan ${autoNet >= 0 ? '+' : ''}${formatPoints(autoNet)}` : message;
  };

  /** Un tour ; `fast` en auto. Retourne false si le tour n'a pas pu être joué. */
  const spin = async (fast = false): Promise<boolean> => {
    if (spinning) return false;
    const stake = BETS[bet];
    if ((getWallet()?.balance ?? 0) < stake) {
      message = 'Pas assez de points pour cette mise.';
      render();
      return false;
    }
    if (!auto.running()) autoSpins = 0;
    spinning = true;
    message = '…';
    const release = holdWallet();
    render();
    // Les rouleaux défilent pendant qu'on attend le tirage du serveur, puis s'arrêtent un par un.
    const rolling = reels.map((el, i) => {
      el.classList.add('spin');
      let k = i * 2;
      return window.setInterval(() => (el.firstElementChild!.textContent = SYMBOLS[k++ % SYMBOLS.length]), 70);
    });
    timers.push(...rolling);
    try {
      const r = await spinSlots(stake);
      for (let i = 0; i < 3; i++) {
        await new Promise((ok) => timers.push(window.setTimeout(ok, fast ? (i === 0 ? 250 : 150) : i === 0 ? 700 : 450)));
        clearInterval(rolling[i]);
        reels[i].classList.remove('spin');
        reels[i].firstElementChild!.textContent = SYMBOLS[r.reels[i]];
        blip(300 + i * 80);
      }
      const won = r.payout > 0;
      reels.forEach((el) => el.classList.toggle('win', won));
      message = won ? `Gagné : ${formatPoints(r.payout)} points (×${r.payout / r.stake}) !` : `Perdu : ${NAMES[r.reels[0]]}, ${NAMES[r.reels[1]]}, ${NAMES[r.reels[2]]}.`;
      if (won) blip(r.payout / r.stake >= 36 ? 1200 : 880);
      if (auto.running()) {
        autoSpins++;
        autoNet += r.payout - r.stake;
        // un petit temps pour voir le résultat avant le tour suivant
        await new Promise((ok) => timers.push(window.setTimeout(ok, won ? 900 : 350)));
      }
      return true;
    } catch (e) {
      message = (e as Error).message;
      return false;
    } finally {
      rolling.forEach(clearInterval);
      reels.forEach((el) => el.classList.remove('spin'));
      release();
      spinning = false;
      render();
    }
  };

  const offWallet = onWallet(render);
  const offKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft') bet = Math.max(0, bet - 1);
    else if (key === 'arrowright') bet = Math.min(BETS.length - 1, bet + 1);
    else if (key === ' ' || key === 'enter') {
      if (!auto.running()) void spin();
    } else if (key === 's') auto.stop();
    else if (key === 'backspace') {
      e.preventDefault();
      return navigate('/points');
    } else return;
    e.preventDefault();
    render();
  });
  render();
  return () => {
    auto.stop();
    timers.forEach((t) => (clearInterval(t), clearTimeout(t)));
    offWallet();
    offKeys();
  };
}
