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

const W = 520; // largeur logique : tout est dessiné dans ce repère, puis mis à l'échelle de la place disponible
const PAD = 12;
const TOP = 22;
const SLOT_H = 30;
const STEP_MS = 115; // une rangée
const FLASH_MS = 650;
const FLASH_BIG_MS = 1600;

interface Ball {
  path: number[];
  /** right[k] : rebonds à droite parmi les k premiers (calculé une fois au lâcher, pas à chaque image). */
  right: number[];
  slot: number;
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

/** Gain à partir duquel la case est dorée et le son de jackpot joué (×100, en centièmes). */
export const BIG_WIN_X100 = 10000;

/** Multiplicateur en français : « ×0,2 », « ×1000 » (sans espace des milliers, pour tenir dans les cases étroites). */
export const multLabel = (x100: number) => `×${(x100 / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2, useGrouping: false })}`;

export function createPlinkoBoard(): PlinkoBoard {
  const canvas = h('canvas', { class: 'pk-canvas' });
  const el = h('div', { class: 'pk-board' }, canvas);
  const ctx = canvas.getContext('2d');
  let rows = 0;
  let mults: number[] = [];
  let labels: string[] = [];
  let height = 0;
  let dx = 0;
  let dy = 0;
  let scale = 1; // pixels de l'écran par unité logique (place disponible × densité de l'écran)
  let fitW = 0; // dernière largeur de conteneur prise en compte
  let balls: Ball[] = [];
  let flashes: Flash[] = [];
  let raf = 0;
  let colors: Colors = { text: '#2b2f3a', surface: '#ffffff', accent: '#5b6ee1' };
  const pos = { x: 0, y: 0 }; // réutilisé à chaque bille et chaque image

  // Couleurs du thème, relues à chaque changement de plateau et quand une rafale commence.
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
  const contactX = (b: Ball, k: number) => W / 2 + (b.right[k] - k / 2) * dx;
  const contactY = (b: Ball, k: number) => (k >= b.path.length ? slotTop() + SLOT_H / 2 : pegY(k) - pegR() - ballR());

  /** Position de la bille à l'instant `now`, écrite dans `pos`. */
  const ballPos = (b: Ball, now: number) => {
    const t = Math.max(0, (now - b.start) / STEP_MS); // une image peut porter une heure antérieure au lâcher
    const seg = Math.floor(t);
    const f = t - seg;
    // seg 0 : chute depuis le haut jusqu'au premier clou ; puis un rebond (petit arc) par rangée ; le dernier tombe dans la case
    if (seg === 0) {
      const toY = contactY(b, 0);
      const fromY = TOP - dy * 0.9;
      pos.x = contactX(b, 0);
      pos.y = fromY + (toY - fromY) * f * f;
      return;
    }
    const k = Math.min(seg, b.path.length);
    const fx = contactX(b, k - 1);
    const fy = contactY(b, k - 1);
    pos.x = fx + (contactX(b, k) - fx) * f;
    pos.y = fy + (contactY(b, k) - fy) * f - 4 * f * (1 - f) * dy * 0.38;
  };

  const draw = (now: number) => {
    if (!ctx || !rows) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, height);
    // clous : la rangée i en a i + 3, tous dans un seul tracé
    ctx.fillStyle = colors.text;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    const pr = pegR();
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < i + 3; j++) {
        const x = pegX(i, j);
        ctx.moveTo(x + pr, pegY(i));
        ctx.arc(x, pegY(i), pr, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    // cases
    const sw = dx - 3;
    ctx.font = `600 ${Math.max(8, Math.min(13, sw * 0.36))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= rows; k++) {
      const x = slotX(k) - sw / 2;
      const y = slotTop();
      let fl: Flash | undefined;
      for (const f of flashes) if (f.slot === k) fl = f;
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
      ctx.fillText(labels[k] ?? '', x + sw / 2, y + SLOT_H / 2 + 0.5);
    }
    // billes
    const br = ballR();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.surface;
    for (const b of balls) {
      ballPos(b, now);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, br, 0, Math.PI * 2);
      ctx.fillStyle = b.big ? '#ffc933' : colors.accent;
      ctx.fill();
      ctx.stroke();
    }
  };

  // Une seule boucle requestAnimationFrame pour toutes les billes, arrêtée quand plus rien ne bouge.
  const frame = (now: number) => {
    raf = 0;
    let arrived: Ball[] | null = null;
    let kept = 0;
    for (const b of balls) {
      if (now - b.start >= (b.path.length + 1) * STEP_MS) {
        (arrived ??= []).push(b);
        let n = 0;
        for (const f of flashes) if (f.slot !== b.slot) flashes[n++] = f;
        flashes.length = n;
        flashes.push({ slot: b.slot, start: now, big: b.big });
      } else balls[kept++] = b;
    }
    balls.length = kept;
    if (flashes.length) flashes = flashes.filter((f) => now - f.start < (f.big ? FLASH_BIG_MS : FLASH_MS));
    draw(now);
    if (arrived) for (const b of arrived) b.done(b.slot);
    if (balls.length || flashes.length) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  /**
   * Taille du canvas : la largeur du conteneur, sans dépasser sa hauteur maximale (CSS `max-height` de `.pk-board`,
   * la hauteur visible sur ordinateur), proportions gardées ; la résolution suit, pour rester net à toute taille.
   */
  const resize = () => {
    if (!rows) return;
    const dpr = window.devicePixelRatio || 1;
    const maxH = parseFloat(getComputedStyle(el).maxHeight); // « none » donne NaN : pas de limite
    let fit = fitW ? fitW / W : 1;
    if (fitW && maxH > 0) fit = Math.min(fit, maxH / height);
    scale = fit * dpr;
    if (fitW) {
      canvas.style.width = `${Math.floor(W * fit)}px`;
      canvas.style.height = `${Math.floor(height * fit)}px`;
    }
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(height * scale);
    draw(performance.now());
  };

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    const w = Math.floor(entries[entries.length - 1].contentRect.width);
    if (w === fitW) return; // la hauteur du conteneur suit le canvas : on ne réagit qu'à la largeur
    fitW = w;
    resize();
  });
  observer?.observe(el);

  return {
    el,
    setBoard(r, m) {
      rows = r;
      mults = m;
      labels = mults.map(multLabel);
      dx = (W - 2 * PAD) / (r + 1);
      dy = Math.min(dx * 0.9, 34);
      height = Math.ceil(TOP + r * dy + 4 + SLOT_H + PAD);
      readColors();
      resize();
      if (balls.length || flashes.length) kick();
    },
    drop(path, opts = {}) {
      if (!balls.length) readColors(); // pas à chaque bille d'une rafale (relecture du style coûteuse)
      const right = [0];
      for (let i = 0; i < path.length; i++) right.push(right[i] + path[i]);
      return new Promise<number>((done) => {
        balls.push({ path, right, slot: right[path.length], start: performance.now(), big: !!opts.big, done });
        kick();
      });
    },
    busy: () => balls.length > 0,
    destroy() {
      observer?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const pending = balls;
      balls = [];
      flashes = [];
      for (const b of pending) b.done(b.slot); // libère ceux qui attendent
    },
  };
}
