import { h } from './dom';

/** Plateau du Plinko dessiné sur un canvas : clous, cases avec leur multiplicateur, billes qui suivent un chemin donné. */
export interface PlinkoBoard {
  el: HTMLElement;
  /** Redessine le plateau : `rows` rangées et `rows + 1` multiplicateurs (en centièmes, rangés par case). */
  setBoard(rows: number, mults: number[]): void;
  /** Lâche une bille qui suit exactement `path` (0 = gauche, 1 = droite) ; la promesse donne la case atteinte. */
  drop(path: number[], opts?: { big?: boolean }): Promise<number>;
  /** Vrai tant qu'une bille est en l'air. */
  busy(): boolean;
  destroy(): void;
}

const W = 520; // largeur logique ; le canvas est mis à l'échelle par le CSS
const PAD = 12;
const TOP = 22;
const SLOT_H = 30;
const STEP_MS = 115; // une rangée
const FLASH_MS = 650;
const FLASH_BIG_MS = 1600;

interface Ball {
  path: number[];
  start: number;
  big: boolean;
  done: (slot: number) => void;
}
interface Flash {
  slot: number;
  start: number;
  big: boolean;
}
interface Colors {
  text: string;
  surface: string;
  accent: string;
}

/** Multiplicateur en français : « ×0,2 », « ×1000 ». */
export const multLabel = (x100: number) => `×${(x100 / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;

const slotOf = (path: number[]) => path.reduce((s, v) => s + v, 0);

export function createPlinkoBoard(): PlinkoBoard {
  const canvas = h('canvas', { class: 'pk-canvas' });
  const el = h('div', { class: 'pk-board' }, canvas);
  const ctx = canvas.getContext('2d');
  let rows = 0;
  let mults: number[] = [];
  let height = 0;
  let dx = 0;
  let dy = 0;
  let dpr = 1;
  let balls: Ball[] = [];
  let flashes: Flash[] = [];
  let raf = 0;
  let colors: Colors = { text: '#2b2f3a', surface: '#ffffff', accent: '#5b6ee1' };

  // Couleurs du thème, relues à chaque changement de plateau et à chaque bille.
  const readColors = () => {
    const cs = getComputedStyle(canvas);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    colors = { text: v('--text', colors.text), surface: v('--surface', colors.surface), accent: v('--accent', colors.accent) };
  };

  const pegX = (row: number, j: number) => W / 2 + (j - (row + 2) / 2) * dx;
  const pegY = (row: number) => TOP + row * dy;
  const slotX = (k: number) => W / 2 + (k - rows / 2) * dx;
  const slotTop = () => TOP + rows * dy + 4;
  const ballR = () => Math.max(3.5, dx * 0.24);
  const pegR = () => Math.max(2, dx * 0.1);

  /** Du centre (froid) aux bords (chaud). */
  const slotColor = (k: number) => {
    const edge = Math.abs(k - rows / 2) / (rows / 2);
    return `hsl(${Math.round(210 - 210 * edge)} 70% 46%)`;
  };

  /**
   * Point de contact n° k : la bille posée sur le clou de la rangée k (k < rangées), ou au fond de sa case (k = rangées).
   * Après k rebonds dont r à droite, elle est à r − k/2 écarts du centre : exactement au-dessus du clou de la rangée k.
   */
  const contact = (path: number[], k: number) => {
    let r = 0;
    for (let i = 0; i < k; i++) r += path[i];
    const x = W / 2 + (r - k / 2) * dx;
    return k >= path.length ? { x, y: slotTop() + SLOT_H / 2 } : { x, y: pegY(k) - pegR() - ballR() };
  };

  const ballPos = (b: Ball, now: number) => {
    const t = (now - b.start) / STEP_MS;
    const seg = Math.floor(t);
    const f = t - seg;
    // seg 0 : chute depuis le haut jusqu'au premier clou ; puis un rebond (petit arc) par rangée ; le dernier tombe dans la case
    if (seg === 0) {
      const to = contact(b.path, 0);
      const from = { x: to.x, y: TOP - dy * 0.9 };
      return { x: to.x, y: from.y + (to.y - from.y) * f * f };
    }
    const from = contact(b.path, seg - 1);
    const to = contact(b.path, seg);
    return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f - 4 * f * (1 - f) * dy * 0.38 };
  };

  const draw = (now: number) => {
    if (!ctx || !rows) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, height);
    // clous : la rangée i en a i + 3
    ctx.fillStyle = colors.text;
    ctx.globalAlpha = 0.65;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < i + 3; j++) {
        ctx.beginPath();
        ctx.arc(pegX(i, j), pegY(i), pegR(), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // cases
    const sw = dx - 3;
    ctx.font = `600 ${Math.max(8, Math.min(13, sw * 0.36))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= rows; k++) {
      const x = slotX(k) - sw / 2;
      const y = slotTop();
      const fl = flashes.find((f) => f.slot === k);
      const a = fl ? Math.max(0, 1 - (now - fl.start) / (fl.big ? FLASH_BIG_MS : FLASH_MS)) : 0;
      if (fl?.big && a > 0) {
        ctx.save();
        ctx.shadowColor = '#ffc933';
        ctx.shadowBlur = 22 * a;
        ctx.fillStyle = '#ffc933';
        ctx.fillRect(x, y, sw, SLOT_H);
        ctx.restore();
      }
      ctx.fillStyle = slotColor(k);
      ctx.beginPath();
      ctx.roundRect(x, y, sw, SLOT_H, 5);
      ctx.fill();
      if (fl && a > 0) {
        ctx.fillStyle = fl.big ? `rgba(255, 214, 80, ${0.9 * a})` : `rgba(255, 255, 255, ${0.7 * a})`;
        ctx.beginPath();
        ctx.roundRect(x, y, sw, SLOT_H, 5);
        ctx.fill();
      }
      ctx.fillStyle = fl?.big && a > 0.3 ? '#3a2a00' : '#ffffff';
      ctx.fillText(multLabel(mults[k] ?? 0), x + sw / 2, y + SLOT_H / 2 + 0.5);
    }
    // billes
    for (const b of balls) {
      const p = ballPos(b, now);
      ctx.beginPath();
      ctx.arc(p.x, p.y, ballR(), 0, Math.PI * 2);
      ctx.fillStyle = b.big ? '#ffc933' : colors.accent;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors.surface;
      ctx.stroke();
    }
  };

  const frame = (now: number) => {
    raf = 0;
    const arrived = balls.filter((b) => now - b.start >= (b.path.length + 1) * STEP_MS);
    if (arrived.length) {
      balls = balls.filter((b) => !arrived.includes(b));
      for (const b of arrived) {
        flashes = flashes.filter((f) => f.slot !== slotOf(b.path));
        flashes.push({ slot: slotOf(b.path), start: now, big: b.big });
      }
    }
    flashes = flashes.filter((f) => now - f.start < (f.big ? FLASH_BIG_MS : FLASH_MS));
    draw(now);
    for (const b of arrived) b.done(slotOf(b.path));
    if (balls.length || flashes.length) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  return {
    el,
    setBoard(r, m) {
      rows = r;
      mults = m;
      dx = (W - 2 * PAD) / (r + 1);
      dy = Math.min(dx * 0.9, 34);
      height = Math.ceil(TOP + r * dy + 4 + SLOT_H + PAD);
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.aspectRatio = `${W} / ${height}`;
      readColors();
      draw(performance.now());
      if (balls.length || flashes.length) kick();
    },
    drop(path, opts = {}) {
      readColors();
      return new Promise<number>((done) => {
        balls.push({ path, start: performance.now(), big: !!opts.big, done });
        kick();
      });
    },
    busy: () => balls.length > 0,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const pending = balls;
      balls = [];
      flashes = [];
      for (const b of pending) b.done(slotOf(b.path)); // libère ceux qui attendent
    },
  };
}
