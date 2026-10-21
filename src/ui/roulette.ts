import { isTyping, pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { formatPoints, getWallet, holdWallet, onWallet, spinRoulette } from '../net/points';
import { multiConfigured } from '../net/supabase';
import { navigate } from '../router';
import { autoPlay } from './autoplay';
import { h, hints } from './dom';
import { page } from './layout';

// Roulette européenne : ordre des cases sur la roue, et numéros rouges.
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CHIPS = [1, 5, 10, 25, 100];
const MAX_STAKE = 500;
const colorOf = (n: number) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
const colorName = (n: number) => (n === 0 ? 'vert' : REDS.has(n) ? 'rouge' : 'noir');

export const ROULETTE_RULES = [
  'Roulette européenne : 37 cases, de 0 à 36. Le 0 est vert, les autres sont rouges ou noirs.',
  'Gains (mise comprise) : un numéro plein rapporte 36 fois la mise (le 0 vert aussi) ; une douzaine 3 fois ; rouge, noir, pair, impair, 1–18 ou 19–36 rapportent 2 fois. Sur le 0, toutes ces chances simples perdent.',
  'On peut miser sur plusieurs cases à la fois, jusqu’à 500 points par tour.',
];

/** Mise : clé du serveur (n0..n36, red, black, even, odd, low, high, d1..d3) et libellé. */
interface Spot {
  key: string;
  label: string;
  cls: string;
  area: string; // placement sur la grille du tapis
  r: number; // position pour le clavier
  c: number;
}

function layout(): Spot[] {
  const spots: Spot[] = [{ key: 'n0', label: '0', cls: 'green', area: '1 / 1 / 4 / 2', r: 1, c: 0 }];
  for (let col = 0; col < 12; col++)
    for (let row = 0; row < 3; row++) {
      const n = col * 3 + (3 - row);
      spots.push({ key: `n${n}`, label: String(n), cls: colorOf(n), area: `${row + 1} / ${col + 2}`, r: row, c: col + 1 });
    }
  ['1 – 12', '13 – 24', '25 – 36'].forEach((label, i) =>
    spots.push({ key: `d${i + 1}`, label, cls: 'out', area: `4 / ${2 + i * 4} / 5 / ${6 + i * 4}`, r: 3, c: 1 + i * 4 }),
  );
  (
    [
      ['low', '1 – 18', 'out'],
      ['even', 'Pair', 'out'],
      ['red', 'Rouge', 'red'],
      ['black', 'Noir', 'black'],
      ['odd', 'Impair', 'out'],
      ['high', '19 – 36', 'out'],
    ] as const
  ).forEach(([key, label, cls], i) => spots.push({ key, label, cls: `${cls} outside`, area: `5 / ${2 + i * 2} / 6 / ${4 + i * 2}`, r: 4, c: 1 + i * 2 }));
  return spots;
}

/** Roue en SVG : 37 secteurs, le 0 en haut quand la rotation est nulle. */
function wheelSvg(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  svg.setAttribute('class', 'rl-wheel');
  const step = (2 * Math.PI) / WHEEL.length;
  WHEEL.forEach((n, i) => {
    const a0 = i * step - step / 2 - Math.PI / 2;
    const a1 = a0 + step;
    const path = document.createElementNS(NS, 'path');
    const p = (a: number, r: number) => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
    path.setAttribute('d', `M ${p(a0, 58)} L ${p(a0, 96)} A 96 96 0 0 1 ${p(a1, 96)} L ${p(a1, 58)} A 58 58 0 0 0 ${p(a0, 58)} Z`);
    path.setAttribute('class', `rl-sector ${colorOf(n)}`);
    svg.append(path);
    const t = document.createElementNS(NS, 'text');
    const mid = a0 + step / 2;
    t.setAttribute('x', (Math.cos(mid) * 84).toFixed(2));
    t.setAttribute('y', (Math.sin(mid) * 84).toFixed(2));
    t.setAttribute('transform', `rotate(${((mid * 180) / Math.PI + 90).toFixed(2)} ${(Math.cos(mid) * 84).toFixed(2)} ${(Math.sin(mid) * 84).toFixed(2)})`);
    t.setAttribute('class', 'rl-num');
    t.textContent = String(n);
    svg.append(t);
  });
  const hub = document.createElementNS(NS, 'circle');
  hub.setAttribute('r', '56');
  hub.setAttribute('class', 'rl-hub');
  svg.append(hub);
  return svg;
}

export function rouletteView(root: HTMLElement): () => void {
  const content = page(root, 'Roulette');
  if (!multiConfigured) {
    content.append(h('div', { class: 'card narrow' }, h('h1', {}, 'Roulette'), h('p', { class: 'muted' }, 'La roulette n’est pas disponible en mode local.')));
    return pushKeys((e) => e.key === 'Backspace' && navigate('/'));
  }

  const spots = layout();
  let bets: Record<string, number> = {};
  let lastBets: Record<string, number> = {};
  let chip = 1; // index dans CHIPS
  let cursor = spots.findIndex((s) => s.key === 'red');
  let spinning = false;
  let rotation = 0;
  let message = 'Choisis tes mises, puis lance la roue.';
  const recent: number[] = [];

  const svg = wheelSvg();
  const wheel = h('div', { class: 'rl-wheel-wrap' }, h('div', { class: 'rl-pointer' }), svg);
  const result = h('div', { class: 'rl-result' }, '–');
  const cells = spots.map((s, i) => {
    const el = h('button', { class: `rl-spot ${s.cls}`, type: 'button' }, h('span', {}, s.label));
    el.style.gridArea = s.area;
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      cursor = i;
      add(s.key);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cursor = i;
      remove(s.key);
    });
    return el;
  });
  const table = h('div', { class: 'rl-table' }, ...cells);
  const chips = h('div', { class: 'rl-chips' });
  const stakeEl = h('span', { class: 'stat' });
  const status = h('p', { class: 'status' });
  const recentEl = h('div', { class: 'rl-recent' });
  const spinBtn = h('button', { class: 'field rl-spin', type: 'submit' }, 'Lancer (Espace)');
  spinBtn.addEventListener('mousedown', (e) => e.preventDefault());
  spinBtn.addEventListener('click', () => void spin());
  const clearBtn = h('button', { class: 'field', type: 'button' }, 'Effacer (C)');
  clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
  clearBtn.addEventListener('click', () => clear());
  // Auto : la même mise (celle posée, sinon la précédente), n tours de suite, roue plus rapide.
  let autoNet = 0;
  let autoSpins = 0;
  let autoBets: Record<string, number> = {};
  const auto = autoPlay([5, 10, 25, 50], async () => {
    const stake = Object.values(autoBets).reduce((a, b) => a + b, 0);
    if (!stake) return false;
    if ((getWallet()?.balance ?? 0) < stake) {
      message = 'Plus assez de points pour cette mise : auto arrêté.';
      render();
      return false;
    }
    bets = { ...autoBets };
    return spin(true);
  }, () => {
    if (auto.running()) {
      autoBets = Object.keys(bets).length ? { ...bets } : { ...lastBets };
      autoNet = 0;
      autoSpins = 0;
      if (!Object.keys(autoBets).length) {
        message = 'Pose d’abord une mise pour lancer l’auto.';
        auto.stop();
      }
    }
    render();
  });
  const rules = h('div', { class: 'rules card', hidden: true }, h('h2', {}, 'Règles'), ...ROULETTE_RULES.map((p) => h('p', {}, p)));

  content.classList.add('wide');
  content.append(
    h(
      'div',
      { class: 'game' },
      h('div', { class: 'rl-top' }, wheel, h('div', { class: 'rl-side' }, result, recentEl, stakeEl, chips, h('div', { class: 'rl-buttons' }, spinBtn, clearBtn), auto.el)),
      table,
      status,
      rules,
      hints(['← ↑ → ↓', 'case'], ['Entrée', 'miser'], ['Suppr', 'retirer'], ['+ −', 'jeton'], ['Espace', 'lancer'], ['C', 'effacer'], ['A', 'rejouer la mise'], ['S', 'arrêter l’auto'], ['I', 'règles'], ['Retour arrière', 'quitter']),
    ),
  );

  const total = () => Object.values(bets).reduce((a, b) => a + b, 0);

  const render = () => {
    cells.forEach((el, i) => {
      const amount = bets[spots[i].key];
      el.classList.toggle('cursor', i === cursor);
      el.querySelector('.rl-chip')?.remove();
      if (amount) el.append(h('span', { class: 'rl-chip' }, formatPoints(amount)));
    });
    chips.replaceChildren(
      ...CHIPS.map((v, i) => {
        const b = h('button', { class: 'rl-token' + (i === chip ? ' on' : ''), type: 'button' }, String(v));
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          chip = i;
          render();
        });
        return b;
      }),
    );
    const w = getWallet();
    stakeEl.replaceChildren('Mise ', h('b', {}, formatPoints(total())), ` / ${w ? formatPoints(w.balance) : '…'}`);
    recentEl.replaceChildren(...recent.map((n) => h('span', { class: `rl-ball ${colorOf(n)}` }, String(n))));
    status.textContent = autoSpins ? `${message} · Auto : ${autoSpins} tour${autoSpins > 1 ? 's' : ''}, bilan ${autoNet >= 0 ? '+' : ''}${formatPoints(autoNet)}` : message;
    spinBtn.disabled = spinning || total() === 0 || auto.running();
    auto.setDisabled(spinning && !auto.running());
  };

  const add = (key: string) => {
    if (spinning) return;
    const value = CHIPS[chip];
    const balance = getWallet()?.balance ?? 0;
    if (total() + value > MAX_STAKE) message = `Mise maximale : ${MAX_STAKE} points par tour.`;
    else if (total() + value > balance) message = 'Pas assez de points.';
    else {
      bets = { ...bets, [key]: (bets[key] ?? 0) + value };
      message = 'Espace pour lancer.';
      blip(700);
    }
    render();
  };

  const remove = (key: string) => {
    if (spinning || !bets[key]) return;
    const next = { ...bets };
    next[key] = Math.max(0, next[key] - CHIPS[chip]);
    if (!next[key]) delete next[key];
    bets = next;
    render();
  };

  const clear = () => {
    if (spinning) return;
    bets = {};
    render();
  };

  /** Un tour ; `fast` en auto. Retourne false si le tour n'a pas pu être joué. */
  const spin = async (fast = false): Promise<boolean> => {
    if (spinning || total() === 0) return false;
    if (!auto.running()) autoSpins = 0;
    spinning = true;
    message = 'Rien ne va plus…';
    const release = holdWallet();
    render();
    try {
      const r = await spinRoulette(bets);
      // La roue tourne pour amener la case tirée sous le repère (en haut).
      const index = WHEEL.indexOf(r.number);
      const target = -(index * 360) / WHEEL.length;
      const current = ((rotation % 360) + 360) % 360;
      rotation += 360 * 5 + ((target - current + 720) % 360);
      svg.style.transitionDuration = fast ? '1.3s' : '';
      svg.style.transform = `rotate(${rotation}deg)`;
      result.textContent = '…';
      await new Promise((ok) => setTimeout(ok, fast ? 1400 : 3600));
      result.textContent = String(r.number);
      result.className = `rl-result ${colorOf(r.number)}`;
      recent.unshift(r.number);
      recent.splice(10);
      const net = r.payout - r.stake;
      message = `${r.number} ${colorName(r.number)} : ` + (r.payout ? `gagné ${formatPoints(r.payout)} (${net >= 0 ? '+' : ''}${formatPoints(net)}).` : `perdu ${formatPoints(r.stake)}.`);
      blip(r.payout ? 880 : 200);
      lastBets = bets;
      bets = {};
      if (auto.running()) {
        autoSpins++;
        autoNet += net;
        await new Promise((ok) => setTimeout(ok, r.payout ? 900 : 400));
      }
      return true;
    } catch (e) {
      message = (e as Error).message;
      return false;
    } finally {
      release();
      spinning = false;
      render();
    }
  };

  const move = (dr: number, dc: number) => {
    const cur = spots[cursor];
    // Case la plus proche dans la direction voulue.
    let best = cursor;
    let bestScore = Infinity;
    spots.forEach((s, i) => {
      const r = s.r - cur.r;
      const c = s.c - cur.c;
      if ((dr && Math.sign(r) !== dr) || (dc && Math.sign(c) !== dc)) return;
      const score = dr ? Math.abs(r) * 10 + Math.abs(c) : Math.abs(c) * 10 + Math.abs(r) * 30;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    cursor = best;
    render();
  };

  const offWallet = onWallet(render);
  const offKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft') move(0, -1);
    else if (key === 'arrowright') move(0, 1);
    else if (key === 'arrowup') move(-1, 0);
    else if (key === 'arrowdown') move(1, 0);
    else if (key === 'enter') add(spots[cursor].key);
    else if (key === 'delete' || key === 'x') remove(spots[cursor].key);
    else if (key === '+' || key === '=') chip = Math.min(CHIPS.length - 1, chip + 1);
    else if (key === '-') chip = Math.max(0, chip - 1);
    else if (key === ' ') {
      if (!auto.running()) void spin();
    } else if (key === 's') auto.stop();
    else if (key === 'c') clear();
    else if (key === 'a' && !spinning && Object.keys(lastBets).length) {
      bets = { ...lastBets };
      message = 'Même mise que le tour précédent : Espace pour lancer.';
    } else if (key === 'i') rules.hidden = !rules.hidden;
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
    offWallet();
    offKeys();
  };
}
