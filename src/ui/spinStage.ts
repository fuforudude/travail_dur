// Roulette, machine à sous et Plinko d'un ami, rejoués tour par tour (page « Regarder » et fenêtre sur le côté).

import { blip } from '../core/sound';
import { formatPoints, loadPlinkoPayouts } from '../net/points';
import type { Spin } from '../net/spectate';
import { h } from './dom';
import { BIG_WIN_X100, createPlinkoBoard, multLabel } from './plinkoBoard';
import { PER_SECOND } from './plinkoQueue';
import { colorName, colorOf, WHEEL, wheelSvg } from './roulette';
import { SYMBOLS } from './slots';

const BET_NAMES: Record<string, string> = {
  red: 'Rouge', black: 'Noir', even: 'Pair', odd: 'Impair', low: '1 – 18', high: '19 – 36', d1: '1 – 12', d2: '13 – 24', d3: '25 – 36',
};
const betName = (k: string) => BET_NAMES[k] ?? k.slice(1);
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** Au-delà de ce nombre de tours en attente, les plus vieux passent sans animation (retour au direct). */
const MAX_BEHIND = 8;

export const net = (s: Spin) => s.payout - s.stake;
export const signed = (n: number) => (n > 0 ? '+' : '') + formatPoints(n);

/** Billes d'un tour Plinko : un envoi groupé (paths) ou l'ancien format à une seule bille (path). */
function plinkoBalls(s: Spin): { path: number[]; mult: number }[] {
  const d = s.detail;
  if (Array.isArray(d.paths)) return d.paths.map((path, i) => ({ path, mult: d.mults_x100?.[i] ?? 0 }));
  return d.path ? [{ path: d.path, mult: d.mult_x100 ?? 0 }] : [];
}

export function outcome(s: Spin): string {
  const balls = s.game === 'plinko' ? plinkoBalls(s).length : 0;
  const what =
    s.game === 'roulette'
      ? `${s.detail.number} ${colorName(s.detail.number ?? 0)}`
      : s.game === 'plinko'
        ? balls > 1
          ? `${balls} billes`
          : multLabel(s.detail.mult_x100 ?? s.detail.mults_x100?.[0] ?? 0)
        : (s.detail.reels ?? []).map((r) => SYMBOLS[r]).join(' ');
  return `${what} : ${s.payout ? `gagné ${formatPoints(s.payout)} (${signed(net(s))})` : `perdu ${formatPoints(s.stake)}`}${s.payout === 0 && s.balance === 0 ? ' · tout perdu 💀' : ''}`;
}

export const gameName = (g: Spin['game']) => (g === 'roulette' ? 'Roulette' : g === 'plinko' ? 'Plinko' : 'Machine à sous');

export interface SpinStage {
  roulette: HTMLElement;
  slots: HTMLElement;
  plinko: HTMLElement;
  status: HTMLElement;
  /** Ajoute un tour à rejouer (en file : en mode auto, les animations accélèrent pour rattraper). */
  push(s: Spin): void;
  dispose(): void;
}

/** `onStart` au lancement d'un tour, `onPlayed` une fois le résultat affiché. */
export function spinStage(opts: { sound: boolean; onStart?: (s: Spin) => void; onPlayed?: (s: Spin) => void }): SpinStage {
  const status = h('p', { class: 'status sp-status' }, 'En attente de son prochain tour…');
  const svg = wheelSvg();
  const result = h('div', { class: 'rl-result' }, '–');
  const reels = [4, 5, 3].map((s) => h('div', { class: 'sl-reel' }, h('span', {}, SYMBOLS[s])));
  const roulette = h('div', { class: 'sp-pane on' }, h('h2', {}, 'Roulette'), h('div', { class: 'rl-wheel-wrap' }, h('div', { class: 'rl-pointer' }), svg), result);
  const slots = h('div', { class: 'sp-pane' }, h('h2', {}, 'Machine à sous'), h('div', { class: 'sl-window' }, ...reels));
  const board = createPlinkoBoard();
  const plinko = h('div', { class: 'sp-pane' }, h('h2', {}, 'Plinko'), board.el);
  let shown = '';
  let rotation = 0;
  let disposed = false;
  let playing = false;
  const queue: Spin[] = [];
  const timers = new Set<number>();
  /** Vrai au retour sur l'onglet : les tours en retard passent sans animation. */
  let skip = false;

  /** Résultat affiché et son : au Plinko, le son de gain seulement si la bille rapporte plus que la mise. */
  const finish = (s: Spin, sound = true) => {
    if (disposed) return;
    status.textContent = `${gameName(s.game)} · ${outcome(s)}`;
    if (opts.sound && sound) {
      if (s.game === 'plinko') blip(s.payout > s.stake ? 880 : 300);
      else if (s.payout) blip(s.payout / s.stake >= 36 ? 1200 : 880);
    }
    opts.onPlayed?.(s);
  };

  /**
   * Résultats affichés dans l'ordre des envois, même quand les billes de plusieurs envois tombent en même temps :
   * chaque résultat attend le précédent, puis l'arrivée de ses propres billes.
   */
  let done: Promise<void> = Promise.resolve();
  const chain = (s: Spin, falling: Promise<number>[] = [], sound = true) =>
    (done = done
      .then(() => Promise.all(falling))
      .then(() => finish(s, sound))
      .catch((e: unknown) => console.error(e)));

  /** Attend que plus aucune bille ne tombe (avant de changer de plateau). */
  const settled = async () => {
    while (board.busy() && !disposed) await wait(100);
  };

  /** Vrai si le dernier tour Plinko a lâché ses billes sans attendre leur arrivée (pas de pause avant le suivant). */
  let released = false;

  const play = async (s: Spin, fast: boolean) => {
    released = false;
    // Roulette et machine à sous masquent le plateau : les billes en rattrapage finissent d'abord leur chute.
    if (s.game !== 'plinko') {
      await settled();
      if (disposed) return;
    }
    opts.onStart?.(s);
    roulette.classList.toggle('on', s.game === 'roulette');
    slots.classList.toggle('on', s.game === 'slots');
    plinko.classList.toggle('on', s.game === 'plinko');
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
    } else if (s.game === 'plinko') {
      status.textContent = `Mise ${formatPoints(s.stake)}…`;
      const { rows, risk } = s.detail;
      const balls = plinkoBalls(s);
      if (rows && risk && balls.length) {
        const key = `${rows}:${risk}`;
        if (shown !== key) {
          // Autres réglages : les billes en l'air finissent leur chute sur l'ancien plateau avant qu'on le change.
          const mults = (await loadPlinkoPayouts().catch(() => null))?.get(key);
          await settled();
          if (mults && !disposed) {
            board.setBoard(rows, mults);
            shown = key;
          }
        }
        if (shown === key && !disposed) {
          // L'effet doré reste (c'est ce que voit le joueur), sans son de jackpot.
          // Billes d'un envoi décalées de 1/10 s (au plus ~1 s pour tout l'envoi), sans attendre leur arrivée :
          // même cadence que chez le joueur (PER_SECOND), pour que la fenêtre spectateur ne prenne pas de retard.
          const gap = Math.min(1000 / PER_SECOND, 1000 / balls.length);
          const falling: Promise<number>[] = [];
          for (let i = 0; i < balls.length; i++) {
            if (i > 0) await wait(gap);
            if (disposed) return;
            falling.push(board.drop(balls[i].path, { big: balls[i].mult >= BIG_WIN_X100 }));
          }
          if (balls.length > 1 || fast) {
            // Un seul son et résultat pour l'envoi, à l'arrivée de la dernière bille ; on passe au tour suivant sans pause.
            void chain(s, falling);
            released = true;
            if (balls.length === 1) await wait(200);
            return;
          }
          await chain(s, falling);
          return;
        }
      }
    } else {
      status.textContent = `Mise ${formatPoints(s.stake)}…`;
      reels.forEach((el) => el.classList.remove('win'));
      const rolling = reels.map((el, i) => {
        el.classList.add('spin');
        let k = i * 2;
        const t = window.setInterval(() => (el.firstElementChild!.textContent = SYMBOLS[k++ % SYMBOLS.length]), 70);
        timers.add(t);
        return t;
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
    await chain(s);
  };

  const next = async () => {
    if (playing) return;
    playing = true;
    try {
      while (queue.length && !disposed) {
        // Trop en retard (onglet caché, rafale) : les tours en attente vont au texte et à l'historique sans animation
        // ni son, dans l'ordre ; seul le dernier est rejoué.
        if (queue.length > MAX_BEHIND || skip) {
          while (queue.length > 1) void chain(queue.shift()!, [], false);
        }
        skip = false;
        const s = queue.shift()!;
        const fast = queue.length > 0;
        await play(s, fast);
        // Après des billes lâchées sans attendre, pas de pause de plus : l'écart est déjà fait.
        await wait(queue.length && !released ? 300 : 0);
      }
    } finally {
      playing = false;
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible' && queue.length) skip = true;
  };
  document.addEventListener('visibilitychange', onVisible);

  return {
    roulette,
    slots,
    plinko,
    status,
    push(s) {
      queue.push(s);
      void next();
    },
    dispose() {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      board.destroy();
      timers.forEach(clearInterval);
    },
  };
}
