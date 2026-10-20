// Tower defense : dessin des tours et des ennemis (avec ou sans skin), partagé par le jeu et les caisses.

import { ENEMY_FINISHES, heroOf, skinOf, TOWER_FINISHES, type Finish } from './catalog';
import { ENEMIES, TOWERS } from './engine/data';

export interface Palette {
  bg: string;
  grid: string;
  path: string;
  text: string;
  muted: string;
  accent: string;
  tones: string[]; // --tone1 … --tone5
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim() || '#888888';
  return {
    bg: v('--surface'), grid: v('--border'), path: v('--surface-2'), text: v('--text'), muted: v('--muted'), accent: v('--accent'),
    tones: [1, 2, 3, 4, 5].map((i) => v(`--tone${i}`)),
  };
}

/** Couleur par défaut (sans skin) de chaque tour et de chaque palier d'ennemis. */
const TOWER_TONE: Record<string, number> = { crossbow: 2, cannon: 3, frost: 0, alchemist: 2, tesla: 4, sniper: 1, flamer: 1, bank: 3, railgun: 4, singularity: -1 };
const ENEMY_TONE: Record<string, number> = { early: 1, mid: 3, late: 4, boss: -1 };

export interface Look {
  body: string;
  edge: string;
  glow: string | null;
  blur: number; // 0..1
  alpha: number;
}

export function lookOf(f: Finish | null | undefined, fallback: string, t: number): Look {
  if (!f) return { body: fallback, edge: fallback, glow: null, blur: 0, alpha: 1 };
  let body = f.body;
  let glow = f.glow ?? null;
  let blur = glow ? 0.6 : 0;
  if (f.anim === 'rainbow') {
    body = `hsl(${Math.floor((t * 90) % 360)} 85% 62%)`;
    glow = body;
    blur = 0.8;
  } else if (f.anim === 'pulse') blur = 0.45 + 0.4 * Math.sin(t * 4);
  else if (f.anim === 'flicker') blur = 0.5 + 0.3 * Math.sin(t * 11) * Math.sin(t * 7);
  return { body, edge: f.edge, glow, blur, alpha: f.alpha ?? 1 };
}

export const towerLook = (id: string, finish: Finish | null | undefined, p: Palette, t: number) =>
  lookOf(finish, TOWER_TONE[id] >= 0 ? p.tones[TOWER_TONE[id]] : p.text, t);
export const enemyLook = (id: string, finish: Finish | null | undefined, p: Palette, t: number) => {
  const tier = ENEMIES.find((e) => e.id === id)?.tier ?? 'early';
  return lookOf(finish, ENEMY_TONE[tier] >= 0 ? p.tones[ENEMY_TONE[tier]] : p.text, t);
};

function withLook(g: CanvasRenderingContext2D, look: Look, s: number, f: () => void) {
  g.save();
  g.globalAlpha *= look.alpha;
  if (look.glow && look.blur > 0) {
    g.shadowColor = look.glow;
    g.shadowBlur = s * 0.35 * look.blur;
  }
  f();
  g.restore();
}

function poly(g: CanvasRenderingContext2D, n: number, r: number, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i * Math.PI * 2) / n;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}

/** Tour centrée en (cx, cy), dans une case de `s` pixels. */
export function drawTower(g: CanvasRenderingContext2D, id: string, level: number, cx: number, cy: number, s: number, angle: number, look: Look, t: number, opts: { disabled?: boolean } = {}) {
  g.save();
  g.translate(cx, cy);
  if (opts.disabled) g.globalAlpha = 0.35;
  // socle carré : une tour ne se confond jamais avec un ennemi (ronds), même en noir et blanc
  g.fillStyle = look.body;
  g.globalAlpha *= 0.22;
  g.beginPath();
  g.roundRect(-s / 2 + 2, -s / 2 + 2, s - 4, s - 4, s * 0.18);
  g.fill();
  g.globalAlpha /= 0.22;
  g.strokeStyle = look.edge;
  g.lineWidth = Math.max(1, s * 0.04);
  g.stroke();
  withLook(g, look, s, () => {
    g.fillStyle = look.body;
    g.strokeStyle = look.edge;
    g.lineWidth = Math.max(1, s * 0.05);
    const r = s * 0.3;
    switch (id) {
      case 'crossbow':
        g.rotate(angle);
        g.beginPath();
        g.arc(-r * 0.2, 0, r * 0.95, -1.1, 1.1);
        g.lineWidth = s * 0.09;
        g.strokeStyle = look.body;
        g.stroke();
        g.fillRect(-r * 0.5, -s * 0.05, r * 1.4, s * 0.1);
        break;
      case 'cannon':
        g.rotate(angle);
        g.fillRect(0, -s * 0.09, r * 1.35, s * 0.18);
        g.beginPath();
        g.arc(0, 0, r * 0.85, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        break;
      case 'frost':
        g.rotate(t * 0.5);
        g.lineWidth = s * 0.07;
        g.strokeStyle = look.body;
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.moveTo(Math.cos((i * Math.PI) / 3) * r, Math.sin((i * Math.PI) / 3) * r);
          g.lineTo(-Math.cos((i * Math.PI) / 3) * r, -Math.sin((i * Math.PI) / 3) * r);
          g.stroke();
        }
        g.beginPath();
        g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
        g.fill();
        break;
      case 'alchemist':
        g.fillRect(-s * 0.06, -r, s * 0.12, r * 0.8);
        g.beginPath();
        g.arc(0, r * 0.3, r * 0.65, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = look.edge;
        g.beginPath();
        g.arc(Math.sin(t * 3) * r * 0.2, r * 0.2, s * 0.05, 0, Math.PI * 2);
        g.fill();
        break;
      case 'tesla':
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.lineWidth = s * 0.06;
        g.strokeStyle = look.body;
        g.stroke();
        g.beginPath();
        g.arc(0, 0, r * 0.45, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = look.edge;
        g.lineWidth = s * 0.04;
        g.beginPath();
        g.moveTo(-r * 0.2, -r * 0.35);
        g.lineTo(r * 0.1, -r * 0.05);
        g.lineTo(-r * 0.1, r * 0.05);
        g.lineTo(r * 0.2, r * 0.35);
        g.stroke();
        break;
      case 'sniper':
        g.rotate(angle);
        g.fillRect(0, -s * 0.035, r * 1.6, s * 0.07);
        poly(g, 3, r * 0.8);
        g.fill();
        g.stroke();
        break;
      case 'flamer':
        g.rotate(angle);
        g.beginPath();
        g.moveTo(r * 0.2, -s * 0.08);
        g.lineTo(r * 1.3, -s * 0.15);
        g.lineTo(r * 1.3, s * 0.15);
        g.lineTo(r * 0.2, s * 0.08);
        g.closePath();
        g.fill();
        g.fillRect(-r * 0.7, -r * 0.7, r * 1.2, r * 1.4);
        g.strokeRect(-r * 0.7, -r * 0.7, r * 1.2, r * 1.4);
        break;
      case 'bank':
        poly(g, 4, r, 0);
        g.fill();
        g.stroke();
        g.fillStyle = look.edge;
        g.font = `bold ${Math.round(s * 0.32)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('$', 0, s * 0.02);
        break;
      case 'railgun':
        g.rotate(angle);
        g.fillRect(-r * 0.3, -s * 0.13, r * 1.9, s * 0.07);
        g.fillRect(-r * 0.3, s * 0.06, r * 1.9, s * 0.07);
        g.fillRect(-r * 0.8, -r * 0.6, r * 0.9, r * 1.2);
        g.strokeRect(-r * 0.8, -r * 0.6, r * 0.9, r * 1.2);
        break;
      case 'singularity':
        g.rotate(t * 2);
        g.lineWidth = s * 0.08;
        g.strokeStyle = look.body;
        for (let i = 0; i < 3; i++) {
          g.beginPath();
          g.arc(0, 0, r, (i * Math.PI * 2) / 3, (i * Math.PI * 2) / 3 + 1.3);
          g.stroke();
        }
        g.fillStyle = look.edge;
        g.beginPath();
        g.arc(0, 0, r * 0.4, 0, Math.PI * 2);
        g.fill();
        break;
    }
  });
  g.restore();
  // niveau : petits points en bas à gauche
  g.fillStyle = look.edge;
  for (let l = 0; l < level; l++) g.fillRect(cx - s / 2 + 4 + l * (s / 6), cy + s / 2 - 6, s / 8, 3);
}

/** Taille relative de chaque ennemi. */
const SIZE: Record<string, number> = {
  prowler: 0.26, runner: 0.2, brute: 0.32, larva: 0.14, bat: 0.24, armored: 0.3, shade: 0.24, healer: 0.26, shieldbearer: 0.27,
  splitter: 0.3, troll: 0.36, shaman: 0.27, burrower: 0.29, colossus: 0.42, specter: 0.28, golem: 0.4, wyvern: 0.38,
  necromancer: 0.3, titan: 0.48, devourer: 0.56,
};
export const enemyRadius = (id: string, cell: number, mini = false) => (mini ? 0.18 : SIZE[id] ?? 0.26) * cell;

/** Ennemi centré en (cx, cy), de rayon r pixels. */
export function drawEnemy(g: CanvasRenderingContext2D, id: string, cx: number, cy: number, r: number, look: Look, t: number) {
  g.save();
  g.translate(cx, cy);
  withLook(g, look, r * 3, () => {
    g.fillStyle = look.body;
    g.strokeStyle = look.edge;
    g.lineWidth = Math.max(1, r * 0.14);
    const circle = (rr = r) => {
      g.beginPath();
      g.arc(0, 0, rr, 0, Math.PI * 2);
      g.fill();
    };
    switch (id) {
      case 'brute':
      case 'colossus':
        g.beginPath();
        g.roundRect(-r, -r, 2 * r, 2 * r, r * 0.35);
        g.fill();
        g.stroke();
        break;
      case 'bat':
      case 'wyvern': {
        const flap = Math.sin(t * 12) * 0.35;
        g.beginPath();
        g.moveTo(0, -r * 0.3);
        g.lineTo(-r * 1.2, -r * (0.2 + flap));
        g.lineTo(-r * 0.4, r * 0.5);
        g.lineTo(0, r * 0.2);
        g.lineTo(r * 0.4, r * 0.5);
        g.lineTo(r * 1.2, -r * (0.2 + flap));
        g.closePath();
        g.fill();
        circle(r * 0.45);
        if (id === 'wyvern') g.stroke();
        break;
      }
      case 'armored':
        poly(g, 6, r, Math.PI / 6);
        g.fill();
        g.stroke();
        break;
      case 'golem':
        poly(g, 4, r * 1.1);
        g.fill();
        g.stroke();
        break;
      case 'shade':
        g.globalAlpha *= 0.7;
        circle();
        g.setLineDash([r * 0.4, r * 0.3]);
        g.stroke();
        break;
      case 'specter':
        g.globalAlpha *= 0.75;
        g.beginPath();
        g.arc(0, -r * 0.1, r, Math.PI, 0);
        for (let i = 0; i <= 4; i++) g.lineTo(r - (i * r) / 2, r * (0.7 + (i % 2) * 0.3 + Math.sin(t * 6 + i) * 0.08));
        g.closePath();
        g.fill();
        break;
      case 'burrower':
        g.beginPath();
        g.arc(0, r * 0.3, r, Math.PI, 0);
        g.closePath();
        g.fill();
        g.stroke();
        break;
      default:
        circle();
        if (id === 'troll' || id === 'titan' || id === 'devourer' || id === 'splitter') g.stroke();
    }
    // détails
    g.fillStyle = look.edge;
    g.strokeStyle = look.edge;
    if (id === 'healer') {
      g.fillRect(-r * 0.12, -r * 0.55, r * 0.24, r * 1.1);
      g.fillRect(-r * 0.55, -r * 0.12, r * 1.1, r * 0.24);
    } else if (id === 'shieldbearer') {
      g.lineWidth = r * 0.25;
      g.beginPath();
      g.arc(0, 0, r * 1.15, -0.9, 0.9);
      g.stroke();
    } else if (id === 'splitter') {
      g.lineWidth = r * 0.12;
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(0, r);
      g.stroke();
    } else if (id === 'shaman') {
      g.lineWidth = r * 0.1;
      g.beginPath();
      g.arc(0, 0, r * (1.25 + 0.1 * Math.sin(t * 5)), 0, Math.PI * 2);
      g.stroke();
    } else if (id === 'necromancer' || id === 'troll') {
      g.beginPath();
      g.arc(-r * 0.35, -r * 0.15, r * 0.15, 0, Math.PI * 2);
      g.arc(r * 0.35, -r * 0.15, r * 0.15, 0, Math.PI * 2);
      g.fill();
    } else if (id === 'titan') {
      g.beginPath();
      g.moveTo(-r * 0.6, -r * 0.7);
      g.lineTo(-r * 0.6, -r * 1.25);
      g.lineTo(-r * 0.2, -r * 0.95);
      g.lineTo(0, -r * 1.35);
      g.lineTo(r * 0.2, -r * 0.95);
      g.lineTo(r * 0.6, -r * 1.25);
      g.lineTo(r * 0.6, -r * 0.7);
      g.closePath();
      g.fill();
    } else if (id === 'devourer') {
      const open = 0.25 + 0.2 * Math.sin(t * 3);
      g.fillStyle = '#000000';
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r * 0.8, -open, open);
      g.closePath();
      g.fill();
      // Bagou : une invite de terminal sur le front
      g.fillStyle = '#7dff8a';
      g.font = `bold ${Math.max(6, r * 0.5)}px monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('$_', -r * 0.2, -r * 0.45);
    } else if (id === 'runner') {
      g.globalAlpha *= 0.5;
      g.fillRect(-r * 2.2, -r * 0.15, r * 1.2, r * 0.3);
    }
  });
  g.restore();
}

// --- Héros -------------------------------------------------------------------------------------

/** Couleur et emblème de chaque héros. */
const HERO_LOOK: Record<string, [string, string]> = {
  bricolette: ['#d08a2e', '🔧'], frigo: ['#5fb4ff', '❄'], turbo: ['#e04a3a', '☕'], cogneur: ['#8a4fd6', '✊'],
  grippesou: ['#e6b422', '¤'], pansement: ['#3fae7a', '✚'], longuevue: ['#2a8fa8', '◎'], laprime: ['#b8325a', '✦'],
};

/** Médaillon d'un héros : un cercle à sa couleur, son emblème au centre. */
export function drawHero(g: CanvasRenderingContext2D, id: string, cx: number, cy: number, r: number, p: Palette) {
  const [color, sign] = HERO_LOOK[id] ?? [p.accent, '?'];
  g.save();
  g.fillStyle = color;
  g.strokeStyle = p.text;
  g.lineWidth = Math.max(1.5, r * 0.08);
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `${Math.round(r * 1.05)}px system-ui, "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(sign, cx, cy + r * 0.06);
  g.restore();
}

// --- Aperçus (caisses, collection) -----------------------------------------------------------

/** Petit canevas montrant un objet du catalogue (tour, héros ou skin). */
export function previewItem(item: string, px = 64, finishOverride?: Finish | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = px * ratio;
  canvas.height = px * ratio;
  canvas.style.width = `${px}px`;
  canvas.style.height = `${px}px`;
  canvas.className = 'td-preview';
  const g = canvas.getContext('2d')!;
  g.scale(ratio, ratio);
  const p = readPalette();
  const skin = skinOf(item);
  if (skin?.target === 'enemy' || (!skin && ENEMIES.some((e) => e.id === item))) {
    const id = skin?.subject ?? item;
    drawEnemy(g, id, px / 2, px / 2, Math.min(px * 0.36, enemyRadius(id, px) * 1.4), enemyLook(id, finishOverride ?? skin?.finish, p, 0), 0);
    return canvas;
  }
  const hero = heroOf(item);
  if (hero) {
    drawHero(g, hero.id, px / 2, px / 2, px * 0.42, p);
    return canvas;
  }
  const tower = TOWERS.find((t) => t.id === (skin?.subject ?? item));
  if (tower) drawTower(g, tower.id, 0, px / 2, px / 2, px * 0.9, -Math.PI / 4, towerLook(tower.id, finishOverride ?? skin?.finish, p, 0), 0);
  return canvas;
}

export const finishById = (target: 'tower' | 'enemy', id: string) => (target === 'tower' ? TOWER_FINISHES : ENEMY_FINISHES).find((f) => f.id === id) ?? null;
