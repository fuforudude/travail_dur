// Roulette et machine à sous d'un ami, rejouées tour par tour (page « Regarder » et fenêtre sur le côté).

import { blip } from '../core/sound';
import { formatPoints } from '../net/points';
import type { Spin } from '../net/spectate';
import { h } from './dom';
import { colorName, colorOf, WHEEL, wheelSvg } from './roulette';
import { SYMBOLS } from './slots';

const BET_NAMES: Record<string, string> = {
  red: 'Rouge', black: 'Noir', even: 'Pair', odd: 'Impair', low: '1 – 18', high: '19 – 36', d1: '1 – 12', d2: '13 – 24', d3: '25 – 36',
};
const betName = (k: string) => BET_NAMES[k] ?? k.slice(1);
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export const net = (s: Spin) => s.payout - s.stake;
export const signed = (n: number) => (n > 0 ? '+' : '') + formatPoints(n);

export function outcome(s: Spin): string {
  const what = s.game === 'roulette' ? `${s.detail.number} ${colorName(s.detail.number ?? 0)}` : (s.detail.reels ?? []).map((r) => SYMBOLS[r]).join(' ');
  return `${what} : ${s.payout ? `gagné ${formatPoints(s.payout)} (${signed(net(s))})` : `perdu ${formatPoints(s.stake)}`}${s.payout === 0 && s.balance === 0 ? ' · tout perdu 💀' : ''}`;
}

export interface SpinStage {
  roulette: HTMLElement;
  slots: HTMLElement;
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
  let rotation = 0;
  let disposed = false;
  let playing = false;
  const queue: Spin[] = [];
  const timers = new Set<number>();

  const play = async (s: Spin, fast: boolean) => {
    opts.onStart?.(s);
    roulette.classList.toggle('on', s.game === 'roulette');
    slots.classList.toggle('on', s.game === 'slots');
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
    status.textContent = `${s.game === 'roulette' ? 'Roulette' : 'Machine à sous'} · ${outcome(s)}`;
    if (opts.sound && s.payout) blip(s.payout / s.stake >= 36 ? 1200 : 880);
    opts.onPlayed?.(s);
  };

  const next = async () => {
    if (playing) return;
    playing = true;
    while (queue.length && !disposed) {
      const s = queue.shift()!;
      await play(s, queue.length > 0);
      await wait(queue.length ? 300 : 0);
    }
    playing = false;
  };

  return {
    roulette,
    slots,
    status,
    push(s) {
      queue.push(s);
      void next();
    },
    dispose() {
      disposed = true;
      timers.forEach(clearInterval);
    },
  };
}
