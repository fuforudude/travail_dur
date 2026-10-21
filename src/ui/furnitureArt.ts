// Meubles dessinés en SVG isométrique, dans la projection de la pièce : des volumes simples
// ombrés comme les murs (lumière venant de la gauche : face gauche claire, face droite sombre).
// Chaque meuble est décrit dans son propre repère (u le long de sa largeur, v vers son avant,
// z en pixels vers le haut) ; une orientation le fait vraiment tourner, on voit donc son dos.

import { baseOf, finishOf, footprint } from '../net/apartment';

const NS = 'http://www.w3.org/2000/svg';
export const TW = 96; // largeur d'une case du sol à l'écran
export const TH = 48; // hauteur d'une case (rapport 2:1)
const RX = TW / Math.SQRT2; // demi-axes à l'écran d'un cercle de rayon 1 posé au sol
const RY = TH / Math.SQRT2;

type Pt = readonly [number, number];
/** Point de la grille (x, y), surélevé de z pixels, relatif au coin du fond de la pièce. */
export const iso = (x: number, y: number, z = 0): Pt => [((x - y) * TW) / 2, ((x + y) * TH) / 2 - z];

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
const pts = (...p: Pt[]) => p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

/** Éclaircit (k > 0) ou assombrit (k < 0) une couleur #rrggbb. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => {
    const c = (n >> s) & 255;
    return Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

const WOOD = '#a8744a';
const DARK = '#2e3138';
const METAL = '#a3abb5';
const LINEN = '#f4f0e8';

/** Couleur principale de chaque finition (la standard garde celle du meuble). */
const FINISH_MAIN: Record<string, string> = {
  ruby: '#b3283f',
  ocean: '#2d6fa3',
  jade: '#2e8b62',
  pastel: '#e7b6d3',
  night: '#2b3352',
  gold: '#e0ae2e',
  neon: '#ff3fd2',
  diamond: '#bfe9ff',
  obsidian: '#231e2d',
  rainbow: '#e0504a',
  ghost: '#eef2f8',
  perso: '#ffffff', // blanc : la photo en papier peint garde ainsi l'ombrage des faces
};

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}
interface Part {
  b: Box;
  key: number; // départage les volumes qui se chevauchent : le plus en avant est dessiné après
  nodes: SVGElement[];
}

/** Un meuble en cours de dessin : ses volumes, triés du fond vers l'avant au moment de l'assembler. */
class Sketch {
  readonly parts: Part[] = [];
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly r: number,
    readonly main: string,
  ) {}

  /** Repère du meuble → grille (emprise posée en 0, 0). */
  at(u: number, v: number): Pt {
    const { w, h } = this;
    if (this.r === 1) return [v, w - u];
    if (this.r === 2) return [w - u, h - v];
    if (this.r === 3) return [h - v, u];
    return [u, v];
  }
  /** Grille → repère du meuble (inverse de at). */
  local(x: number, y: number): Pt {
    const { w, h } = this;
    if (this.r === 1) return [w - y, x];
    if (this.r === 2) return [w - x, h - y];
    if (this.r === 3) return [y, h - x];
    return [x, y];
  }
  /** Une face dont la normale locale est (nu, nv) est-elle tournée vers nous ? */
  sees(nu: number, nv: number): boolean {
    const [a, b] = this.at(nu, nv);
    const [c, d] = this.at(0, 0);
    return a - c > 0.01 || b - d > 0.01;
  }
  grow(x: number, y: number) {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
  }
  p(u: number, v: number, z: number): Pt {
    const q = iso(...this.at(u, v), z);
    this.grow(q[0], q[1]);
    return q;
  }
  poly(points: Pt[], fill: string, extra: Record<string, string | number> = {}) {
    return el('polygon', { points: pts(...points), fill, class: 'm', ...extra });
  }
  add(b: Box, bias: number, ...nodes: SVGElement[]): Part {
    const part = { b, key: (b.x0 + b.x1 + b.y0 + b.y1) / 2 + bias, nodes };
    this.parts.push(part);
    return part;
  }

  /** Pavé de (u, v, z) à (u + du, v + dv, z + dz) : dessus et deux faces avant. */
  cube(u: number, v: number, z: number, du: number, dv: number, dz: number, color: string, opts: { bias?: number; opacity?: number } = {}): Part {
    const [ax, ay] = this.at(u, v);
    const [bx, by] = this.at(u + du, v + dv);
    const b: Box = { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by), z0: z, z1: z + dz };
    const P = (x: number, y: number, zz: number) => {
      const q = iso(x, y, zz);
      this.grow(q[0], q[1]);
      return q;
    };
    const o: Record<string, number> = opts.opacity !== undefined ? { 'fill-opacity': opts.opacity } : {};
    return this.add(
      b,
      opts.bias ?? 0,
      this.poly([P(b.x0, b.y1, b.z0), P(b.x1, b.y1, b.z0), P(b.x1, b.y1, b.z1), P(b.x0, b.y1, b.z1)], shade(color, 0.04), o),
      this.poly([P(b.x1, b.y0, b.z0), P(b.x1, b.y1, b.z0), P(b.x1, b.y1, b.z1), P(b.x1, b.y0, b.z1)], shade(color, -0.2), o),
      this.poly([P(b.x0, b.y0, b.z1), P(b.x1, b.y0, b.z1), P(b.x1, b.y1, b.z1), P(b.x0, b.y1, b.z1)], shade(color, 0.16), o),
    );
  }

  /** Détail plat collé sur une face verticale (normale locale nu, nv), visible seulement si elle nous regarde. */
  face(part: Part, nu: number, nv: number, corners: [number, number, number][], fill: string, extra: Record<string, string | number> = {}) {
    if (!this.sees(nu, nv)) return;
    part.nodes.push(this.poly(corners.map(([u, v, z]) => this.p(u, v, z)), fill, extra));
  }
  /** Rectangle sur la face avant d'un pavé (plan v), de u0 à u1 et de z0 à z1. */
  front(part: Part, v: number, u0: number, u1: number, z0: number, z1: number, fill: string, extra: Record<string, string | number> = {}) {
    this.face(part, 0, 1, [[u0, v, z0], [u1, v, z0], [u1, v, z1], [u0, v, z1]], fill, extra);
  }
  /** Rectangle posé à plat à la hauteur z (dessus d'un pavé). */
  top(part: Part, z: number, u0: number, v0: number, u1: number, v1: number, fill: string, extra: Record<string, string | number> = {}) {
    part.nodes.push(this.poly([this.p(u0, v0, z), this.p(u1, v0, z), this.p(u1, v1, z), this.p(u0, v1, z)], fill, extra));
  }

  /** Cylindre (ou tronc de cône si r0 ≠ r1) vertical, centré en (cu, cv). */
  cyl(cu: number, cv: number, z: number, r0: number, r1: number, dz: number, color: string, topColor = shade(color, 0.16), bias = 0): Part {
    const [x, y] = this.at(cu, cv);
    const [bx, by] = iso(x, y, z);
    const [tx, ty] = iso(x, y, z + dz);
    const [a0, b0, a1, b1] = [r0 * RX, r0 * RY, r1 * RX, r1 * RY];
    this.grow(bx - a0, by + b0);
    this.grow(bx + a0, by + b0);
    this.grow(tx - a1, ty - b1);
    this.grow(tx + a1, ty - b1);
    const f = (n: number) => n.toFixed(1);
    const side = el('path', { d: `M${f(bx - a0)},${f(by)} A${f(a0)} ${f(b0)} 0 0 0 ${f(bx + a0)},${f(by)} L${f(tx + a1)},${f(ty)} L${f(tx - a1)},${f(ty)} Z`, fill: color, class: 'm' });
    const dark = el('path', { d: `M${f(bx)},${f(by + b0)} A${f(a0)} ${f(b0)} 0 0 0 ${f(bx + a0)},${f(by)} L${f(tx + a1)},${f(ty)} L${f(tx)},${f(ty + b1)} Z`, fill: 'rgb(0 0 0 / 16%)' });
    const cap = el('ellipse', { cx: f(tx), cy: f(ty), rx: f(a1), ry: f(b1), fill: topColor, class: 'm' });
    const r = Math.max(r0, r1);
    return this.add({ x0: x - r, x1: x + r, y0: y - r, y1: y + r, z0: z, z1: z + dz }, bias, side, dark, cap);
  }

  /** Boule de rayon rad (en cases) dont le centre est à la hauteur z. */
  ball(cu: number, cv: number, z: number, rad: number, color: string, bias = 0): Part {
    const [x, y] = this.at(cu, cv);
    const [cx, cy] = iso(x, y, z);
    const R = rad * RX;
    this.grow(cx - R, cy - R);
    this.grow(cx + R, cy + R);
    const f = (n: number) => n.toFixed(1);
    return this.add(
      { x0: x - rad, x1: x + rad, y0: y - rad, y1: y + rad, z0: z - R, z1: z + R },
      bias,
      el('circle', { cx: f(cx), cy: f(cy), r: f(R), fill: color, class: 'm' }),
      el('circle', { cx: f(cx - R * 0.3), cy: f(cy - R * 0.35), r: f(R * 0.45), fill: 'rgb(255 255 255 / 18%)' }),
      el('path', { d: `M${f(cx + R * 0.94)},${f(cy - R * 0.35)} A${f(R)} ${f(R)} 0 0 1 ${f(cx - R * 0.35)},${f(cy + R * 0.94)} A${f(R * 1.25)} ${f(R * 1.25)} 0 0 0 ${f(cx + R * 0.94)},${f(cy - R * 0.35)} Z`, fill: 'rgb(0 0 0 / 14%)' }),
    );
  }

  /**
   * Objet plat dressé dans le plan v (guitare, anses…), dessiné en coordonnées (u, z) : x = u en cases,
   * y = z en pixels vers le haut. Vu de dos, il apparaît naturellement retourné ; `facing` le dit.
   */
  plane(v: number, u0: number, u1: number, z0: number, z1: number, draw: (g: SVGGElement, facing: boolean) => void, bias = 0): Part {
    const [ox, oy] = iso(...this.at(0, v));
    const [ux, uy] = iso(...this.at(1, v));
    const g = el('g', { transform: `matrix(${(ux - ox).toFixed(3)} ${(uy - oy).toFixed(3)} 0 -1 ${ox.toFixed(1)} ${oy.toFixed(1)})` });
    draw(g, this.sees(0, 1));
    for (const [u, z] of [[u0, z0], [u1, z0], [u0, z1], [u1, z1]]) this.p(u, v, z);
    const [ax, ay] = this.at(u0, v);
    const [bx, by] = this.at(u1, v);
    return this.add({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by), z0, z1 }, bias, g);
  }

  /**
   * Assemble les volumes du fond vers l'avant : A passe avant B si A est entièrement derrière B
   * sur un axe (x, y) ou dessous (z) ; sinon, le plus en avant (key) est dessiné après.
   */
  build(cls: string): SVGGElement {
    const e = 0.001;
    const behind = (a: Box, b: Box) => a.x1 <= b.x0 + e || a.y1 <= b.y0 + e || a.z1 <= b.z0 + e;
    const n = this.parts.length;
    const before = this.parts.map(() => new Set<number>());
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const [a, b] = [this.parts[i].b, this.parts[j].b];
        if (behind(a, b) && !behind(b, a)) before[j].add(i);
      }
    const done = new Set<number>();
    const g = el('g', { class: cls });
    while (done.size < n) {
      let pick = -1;
      for (let i = 0; i < n; i++) {
        if (done.has(i) || [...before[i]].some((k) => !done.has(k))) continue;
        if (pick < 0 || this.parts[i].key < this.parts[pick].key) pick = i;
      }
      // Cycle (cas dégénéré) : on prend simplement le plus au fond.
      if (pick < 0) for (let i = 0; i < n; i++) if (!done.has(i) && (pick < 0 || this.parts[i].key < this.parts[pick].key)) pick = i;
      done.add(pick);
      g.append(...this.parts[pick].nodes);
    }
    return g;
  }
}

/** Feuille en goutte, de la base (bx, by) vers l'angle a (degrés depuis la verticale). */
function leaf(s: Sketch, bx: number, by: number, a: number, len: number, wid: number, fill: string): SVGElement {
  const r = (a * Math.PI) / 180;
  const [dx, dy, px, py] = [Math.sin(r), -Math.cos(r), Math.cos(r), Math.sin(r)];
  const tip: Pt = [bx + dx * len, by + dy * len];
  const c1: Pt = [bx + dx * len * 0.5 + px * wid, by + dy * len * 0.5 + py * wid];
  const c2: Pt = [bx + dx * len * 0.5 - px * wid, by + dy * len * 0.5 - py * wid];
  for (const q of [tip, c1, c2]) s.grow(q[0], q[1]);
  const f = (q: Pt) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
  return el('path', { d: `M${f([bx, by])} Q${f(c1)} ${f(tip)} Q${f(c2)} ${f([bx, by])} Z`, fill, class: 'm' });
}

// ---------------------------------------------------------------------------
// Modèles du sol (repère du meuble : largeur w × profondeur h de son emprise, avant en v = h)
// ---------------------------------------------------------------------------

const FLOOR: Record<string, { main: string; draw: (s: Sketch) => void }> = {
  chair: {
    main: '#b8834c',
    draw(s) {
      const leg = shade(s.main, -0.15);
      for (const [u, v] of [[0.22, 0.22], [0.7, 0.22], [0.22, 0.7], [0.7, 0.7]]) s.cube(u, v, 0, 0.08, 0.08, 36, leg);
      s.cube(0.2, 0.2, 36, 0.6, 0.6, 7, s.main);
      s.cube(0.2, 0.2, 43, 0.08, 0.08, 50, leg);
      s.cube(0.72, 0.2, 43, 0.08, 0.08, 50, leg);
      s.cube(0.28, 0.21, 74, 0.44, 0.06, 17, s.main);
      s.cube(0.28, 0.21, 56, 0.44, 0.06, 8, s.main);
    },
  },
  plant: {
    main: '#c9714a',
    draw(s) {
      s.cyl(0.5, 0.5, 0, 0.15, 0.2, 30, s.main);
      const rim = s.cyl(0.5, 0.5, 28, 0.22, 0.22, 7, shade(s.main, -0.08), '#5a3d26', 0.001);
      const [x, y] = s.at(0.5, 0.5);
      const [bx, by] = iso(x, y, 36);
      const leaves: [number, number, string][] = [
        [-64, 46, '#3d7444'],
        [62, 50, '#3d7444'],
        [-36, 64, '#4c8c4e'],
        [38, 62, '#4c8c4e'],
        [-14, 78, '#5fa158'],
        [16, 72, '#5fa158'],
        [0, 54, '#72b766'],
      ];
      rim.nodes.push(...leaves.map(([a, l, c]) => leaf(s, bx, by, a, l, 15, c)));
    },
  },
  teddy: {
    main: '#b98252',
    draw(s) {
      const light = '#ecd2ae';
      s.ball(0.5, 0.48, 24, 0.26, s.main);
      s.ball(0.33, 0.66, 9, 0.09, s.main);
      s.ball(0.67, 0.66, 9, 0.09, s.main);
      s.ball(0.27, 0.54, 32, 0.08, s.main);
      s.ball(0.73, 0.54, 32, 0.08, s.main);
      s.ball(0.5, 0.62, 24, 0.14, light);
      s.ball(0.36, 0.44, 78, 0.08, s.main, -0.4);
      s.ball(0.64, 0.44, 78, 0.08, s.main, -0.4);
      s.ball(0.5, 0.48, 62, 0.2, s.main);
      s.ball(0.5, 0.64, 56, 0.08, light);
      s.ball(0.5, 0.71, 59, 0.03, DARK);
      s.ball(0.42, 0.62, 67, 0.025, DARK);
      s.ball(0.58, 0.62, 67, 0.025, DARK);
    },
  },
  lamp: {
    main: '#f2dfb2',
    draw(s) {
      s.cyl(0.5, 0.5, 0, 0.17, 0.17, 5, DARK);
      s.cube(0.48, 0.48, 5, 0.04, 0.04, 104, METAL);
      const [x, y] = s.at(0.5, 0.5);
      const [gx, gy] = iso(x, y, 96);
      s.add({ x0: x - 0.2, x1: x + 0.2, y0: y - 0.2, y1: y + 0.2, z0: 90, z1: 140 }, -0.05, el('ellipse', { cx: gx.toFixed(1), cy: gy.toFixed(1), rx: 46, ry: 32, fill: '#fff1b8', 'fill-opacity': 0.25 }));
      s.cyl(0.5, 0.5, 104, 0.25, 0.15, 38, s.main, shade(s.main, -0.35));
    },
  },
  books: {
    main: '#a8723f',
    draw(s) {
      const body = s.cube(0.1, 0.24, 0, 0.8, 0.52, 152, s.main);
      const colors = ['#c0504d', '#4f81bd', '#e6b450', '#9bbb59', '#8064a2', '#d9825b', '#5a9e9a'];
      const shelves: [number, number][] = [
        [8, 50],
        [56, 98],
        [104, 146],
      ];
      let k = 0;
      for (const [z0, z1] of shelves) {
        s.front(body, 0.76, 0.16, 0.84, z0, z1, shade(s.main, -0.5));
        let u = 0.18;
        while (u < 0.76) {
          const w = 0.05 + ((k * 37) % 5) * 0.012;
          const top = z1 - 4 - ((k * 23) % 4) * 3;
          if (u + w > 0.82) break;
          s.front(body, 0.76, u, u + w, z0, top, colors[k % colors.length]);
          u += w + 0.008;
          k++;
          if (k % 6 === 4) u += 0.06; // un trou dans la rangée
        }
      }
    },
  },
  guitar: {
    main: '#d4873a',
    draw(s) {
      s.cube(0.3, 0.36, 0, 0.4, 0.28, 6, DARK);
      s.cube(0.46, 0.4, 6, 0.08, 0.05, 56, DARK, { bias: -0.3 });
      const body = (g: SVGGElement, color: string, back: boolean) => {
        g.append(
          el('ellipse', { cx: 0.5, cy: 36, rx: 0.27, ry: 30, fill: color, class: 'm' }),
          el('ellipse', { cx: 0.5, cy: 74, rx: 0.2, ry: 22, fill: color, class: 'm' }),
          el('ellipse', { cx: 0.5, cy: 46, rx: 0.19, ry: 22, fill: color }),
          el('rect', { x: 0.465, y: 90, width: 0.07, height: 62, fill: '#5a3a1e', class: 'm' }),
          el('rect', { x: 0.44, y: 150, width: 0.12, height: 18, rx: 0.02, fill: '#3a2414', class: 'm' }),
        );
        if (back) return;
        g.append(
          el('ellipse', { cx: 0.5, cy: 38, rx: 0.17, ry: 18, fill: shade(color, 0.25) }),
          el('ellipse', { cx: 0.5, cy: 72, rx: 0.065, ry: 7, fill: '#2a1a0e' }),
          el('rect', { x: 0.41, y: 24, width: 0.18, height: 5, fill: '#3a2414' }),
          ...[0.485, 0.5, 0.515].map((x) => el('line', { x1: x, y1: 26, x2: x, y2: 152, stroke: '#efe8d6', 'stroke-width': 0.7, 'vector-effect': 'non-scaling-stroke' })),
        );
      };
      s.plane(0.47, 0.2, 0.8, 4, 170, (g) => body(g, shade(s.main, -0.45), true), -0.01);
      s.plane(0.52, 0.2, 0.8, 4, 170, (g, facing) => body(g, facing ? s.main : shade(s.main, -0.25), !facing));
    },
  },
  tv: {
    main: '#b07a45',
    draw(s) {
      const cab = s.cube(0.06, 0.3, 0, 0.88, 0.5, 34, s.main);
      s.front(cab, 0.8, 0.1, 0.48, 6, 28, shade(s.main, -0.12));
      s.front(cab, 0.8, 0.52, 0.9, 6, 28, shade(s.main, -0.12));
      s.front(cab, 0.8, 0.27, 0.31, 16, 19, DARK);
      s.front(cab, 0.8, 0.69, 0.73, 16, 19, DARK);
      s.cube(0.42, 0.44, 34, 0.16, 0.12, 8, DARK);
      const tv = s.cube(0.08, 0.47, 42, 0.84, 0.07, 64, '#2a2d34');
      s.front(tv, 0.54, 0.12, 0.88, 46, 102, '#1d4660');
      s.face(tv, 0, 1, [[0.56, 0.54, 46], [0.66, 0.54, 46], [0.8, 0.54, 102], [0.7, 0.54, 102]], 'rgb(255 255 255 / 12%)');
    },
  },
  computer: {
    main: '#c08a52',
    draw(s) {
      const leg = shade(s.main, -0.15);
      for (const [u, v] of [[0.06, 0.14], [0.88, 0.14], [0.06, 0.84], [0.88, 0.84]]) s.cube(u, v, 0, 0.06, 0.06, 54, leg);
      const tower = s.cube(0.66, 0.3, 0, 0.18, 0.46, 46, DARK);
      s.front(tower, 0.76, 0.7, 0.8, 34, 37, '#5fe0a0');
      s.cube(0.04, 0.12, 54, 0.92, 0.8, 6, s.main);
      s.cube(0.46, 0.2, 60, 0.08, 0.06, 12, DARK);
      const mon = s.cube(0.18, 0.24, 68, 0.64, 0.05, 46, '#2a2d34');
      s.front(mon, 0.29, 0.21, 0.79, 71, 111, '#1f3d57');
      const lines: [number, number, number, string][] = [
        [0.25, 0.5, 103, '#8fb7ff'],
        [0.29, 0.62, 97, '#7fd1a8'],
        [0.29, 0.48, 91, '#e6b450'],
        [0.25, 0.4, 85, '#8fb7ff'],
        [0.29, 0.66, 79, '#7fd1a8'],
      ];
      for (const [u0, u1, z, c] of lines) s.front(mon, 0.29, u0, u1, z, z + 2.5, c);
      s.cube(0.26, 0.52, 60, 0.48, 0.16, 3, '#d9dde3');
      s.ball(0.84, 0.62, 62, 0.04, '#d9dde3');
    },
  },
  aquarium: {
    main: '#6b4a32',
    draw(s) {
      s.cube(0.06, 0.22, 0, 0.88, 0.56, 42, s.main);
      s.cube(0.08, 0.24, 42, 0.84, 0.52, 6, '#e3cc95');
      s.plane(0.5, 0.1, 0.9, 48, 92, (g) => {
        const weed = (x: number, hgt: number) => el('path', { d: `M${x},48 q0.04,${hgt / 3} 0,${(2 * hgt) / 3} t0.02,${hgt / 3}`, fill: 'none', stroke: '#3f9a5a', 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke' });
        const fish = (x: number, y: number, c: string, dir: number) =>
          el('path', { d: `M${x},${y} q${0.06 * dir},6 ${0.12 * dir},0 q${-0.06 * dir},-6 ${-0.12 * dir},0 Z M${x + 0.1 * dir},${y} l${0.06 * dir},5 l0,-10 Z`, fill: c });
        g.append(weed(0.2, 30), weed(0.78, 38), weed(0.7, 24), fish(0.32, 74, '#ff8c42', 1), fish(0.66, 62, '#ffd166', -1), el('ellipse', { cx: 0.55, cy: 84, rx: 0.025, ry: 2.5, fill: '#fff', 'fill-opacity': 0.8 }), el('ellipse', { cx: 0.6, cy: 76, rx: 0.018, ry: 1.8, fill: '#fff', 'fill-opacity': 0.8 }));
      }, 0.02);
      const water = s.cube(0.08, 0.24, 48, 0.84, 0.52, 46, '#8fd0e6', { bias: 0.05, opacity: 0.45 });
      s.top(water, 94, 0.08, 0.24, 0.92, 0.76, 'none', { class: 'rim', stroke: '#2c3038', 'stroke-width': 3, 'stroke-linejoin': 'round' });
    },
  },
  arcade: {
    main: '#5a4fcf',
    draw(s) {
      const low = s.cube(0.15, 0.2, 0, 0.7, 0.6, 80, s.main);
      s.front(low, 0.8, 0.45, 0.55, 40, 54, DARK);
      s.front(low, 0.8, 0.48, 0.52, 44, 50, '#ff8c42');
      s.face(low, 1, 0, [[0.85, 0.3, 10], [0.85, 0.8, 50], [0.85, 0.8, 62], [0.85, 0.3, 22]], '#ff5fa2');
      s.face(low, -1, 0, [[0.15, 0.3, 10], [0.15, 0.8, 50], [0.15, 0.8, 62], [0.15, 0.3, 22]], '#ff5fa2');
      const deck = s.cube(0.15, 0.55, 80, 0.7, 0.25, 8, DARK);
      s.top(deck, 88, 0.2, 0.6, 0.8, 0.75, '#3a3f4b');
      s.cube(0.27, 0.65, 88, 0.02, 0.02, 10, METAL);
      s.ball(0.28, 0.66, 100, 0.035, '#e5484d');
      s.ball(0.5, 0.67, 90, 0.03, '#e5484d');
      s.ball(0.6, 0.67, 90, 0.03, '#4f81bd');
      s.ball(0.7, 0.67, 90, 0.03, '#e6b450');
      const up = s.cube(0.15, 0.2, 88, 0.7, 0.35, 66, s.main);
      s.front(up, 0.55, 0.22, 0.78, 96, 134, '#14202e');
      for (const [u, z, c] of [[0.3, 124, '#7fd1a8'], [0.42, 124, '#7fd1a8'], [0.54, 124, '#7fd1a8'], [0.36, 114, '#ff5fa2'], [0.48, 114, '#ff5fa2'], [0.5, 102, '#ffd166']] as const)
        s.front(up, 0.55, u, u + 0.06, z, z + 5, c);
      s.front(up, 0.55, 0.2, 0.8, 140, 151, '#ffd166');
    },
  },
  trophy: {
    main: '#e3b23c',
    draw(s) {
      const ped = s.cube(0.25, 0.25, 0, 0.5, 0.5, 46, '#e7e1d6');
      s.front(ped, 0.75, 0.35, 0.65, 16, 30, '#c9a84c');
      s.cyl(0.5, 0.5, 46, 0.13, 0.13, 4, s.main);
      s.cyl(0.5, 0.5, 50, 0.05, 0.05, 16, s.main);
      s.plane(0.5, 0.22, 0.78, 72, 104, (g) => {
        for (const cx of [0.29, 0.71]) g.append(el('ellipse', { cx, cy: 90, rx: 0.07, ry: 11, fill: 'none', stroke: shade(s.main, -0.2), 'stroke-width': 4, 'vector-effect': 'non-scaling-stroke' }));
      }, -0.01);
      s.cyl(0.5, 0.5, 66, 0.07, 0.22, 38, s.main, shade(s.main, -0.3));
    },
  },
  sofa: {
    main: '#6c8ebf',
    draw(s) {
      for (const [u, v] of [[0.1, 0.16], [1.84, 0.16], [0.1, 0.84], [1.84, 0.84]]) s.cube(u, v, 0, 0.06, 0.06, 8, DARK);
      s.cube(0.04, 0.12, 8, 1.92, 0.82, 24, shade(s.main, -0.1));
      s.cube(0.04, 0.12, 32, 1.92, 0.2, 50, s.main);
      s.cube(0, 0.12, 8, 0.2, 0.84, 46, s.main);
      s.cube(1.8, 0.12, 8, 0.2, 0.84, 46, s.main);
      const cushion = shade(s.main, 0.08);
      s.cube(0.2, 0.32, 32, 0.8, 0.6, 12, cushion);
      s.cube(1.0, 0.32, 32, 0.8, 0.6, 12, cushion);
      s.cube(0.26, 0.34, 44, 0.24, 0.1, 22, '#e9c46a');
    },
  },
  bath: {
    main: '#f3f5f7',
    draw(s) {
      for (const [u, v] of [[0.14, 0.18], [1.86, 0.18], [0.14, 0.82], [1.86, 0.82]]) s.ball(u, v, 4, 0.06, '#c9a84c');
      const tub = s.cube(0.04, 0.1, 8, 1.92, 0.8, 44, s.main);
      s.top(tub, 52, 0.12, 0.18, 1.88, 0.82, shade(s.main, -0.12));
      s.top(tub, 52, 0.16, 0.22, 1.84, 0.78, '#9fd3e8');
      const [x, y] = s.at(1.3, 0.5);
      const [bx, by] = iso(x, y, 52);
      for (const [dx, dy, r] of [[0, 0, 9], [14, 4, 6], [-12, 5, 7], [6, -6, 5]]) tub.nodes.push(el('circle', { cx: bx + dx, cy: by + dy, r, fill: '#fff', 'fill-opacity': 0.85 }));
      s.cyl(0.1, 0.5, 52, 0.035, 0.035, 18, METAL);
      s.cube(0.1, 0.48, 66, 0.14, 0.04, 4, METAL);
    },
  },
  piano: {
    main: '#2a2523',
    draw(s) {
      const body = s.cube(0.08, 0.1, 0, 1.84, 0.42, 118, s.main);
      s.front(body, 0.52, 0.7, 1.3, 84, 104, shade(s.main, 0.18));
      s.front(body, 0.52, 0.94, 1.06, 6, 10, '#c9a84c');
      s.cube(0.16, 0.62, 0, 0.08, 0.08, 60, s.main);
      s.cube(1.76, 0.62, 0, 0.08, 0.08, 60, s.main);
      const shelf = s.cube(0.12, 0.52, 60, 1.76, 0.24, 10, s.main);
      s.top(shelf, 70, 0.16, 0.54, 1.84, 0.73, '#f7f4ec');
      const kw = 1.68 / 24;
      for (let i = 0; i < 23; i++) {
        if (![0, 1, 3, 4, 5].includes(i % 7)) continue;
        const u = 0.16 + (i + 1) * kw;
        s.top(shelf, 70, u - kw * 0.3, 0.54, u + kw * 0.3, 0.64, DARK);
      }
    },
  },
  bed: {
    main: '#7d9fc9',
    draw(s) {
      for (const [u, v] of [[0.06, 0.18], [1.86, 0.18], [0.06, 1.86], [1.86, 1.86]]) s.cube(u, v, 0, 0.08, 0.08, 6, shade(WOOD, -0.3));
      s.cube(0.04, 0.02, 0, 1.92, 0.14, 96, WOOD);
      s.cube(0.04, 0.16, 6, 1.92, 1.8, 24, WOOD);
      s.cube(0.1, 0.16, 30, 1.8, 1.74, 16, LINEN);
      s.cube(0.22, 0.24, 46, 0.66, 0.36, 12, '#fbf8f2');
      s.cube(1.12, 0.24, 46, 0.66, 0.36, 12, '#fbf8f2');
      const blanket = s.cube(0.08, 0.8, 30, 1.84, 1.14, 20, s.main);
      s.top(blanket, 50, 0.08, 1.5, 1.92, 1.62, shade(s.main, 0.22));
      s.cube(0.08, 0.72, 50, 1.84, 0.1, 4, '#fbf9f4');
    },
  },
  // Désordre du début (pas des meubles achetables)
  box: {
    main: '#c8a06a',
    draw(s) {
      const b = s.cube(0.18, 0.2, 0, 0.64, 0.6, 40, s.main);
      s.top(b, 40, 0.45, 0.2, 0.55, 0.8, '#e8d3a6');
      s.front(b, 0.8, 0.45, 0.55, 26, 40, '#e8d3a6');
    },
  },
  trash: {
    main: '#7d8590',
    draw(s) {
      s.cyl(0.5, 0.5, 0, 0.18, 0.21, 44, s.main);
      s.cyl(0.5, 0.5, 44, 0.23, 0.23, 4, shade(s.main, -0.2));
      s.ball(0.42, 0.44, 54, 0.07, '#efe8d6');
      s.ball(0.78, 0.74, 5, 0.05, '#efe8d6');
    },
  },
};

// ---------------------------------------------------------------------------
// Objets muraux : dessin de face (x à droite, y vers le bas, centré), tenant dans ±22 px
// ---------------------------------------------------------------------------

const WALL: Record<string, { main: string; draw: (g: SVGGElement, main: string) => void }> = {
  clock: {
    main: '#8a5a2e',
    draw(g, main) {
      g.append(el('circle', { r: 20, fill: main, class: 'm' }), el('circle', { r: 16, fill: '#f7f1e3', class: 'm' }));
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        const [l0, l1] = i % 3 ? [13, 15] : [11.5, 15];
        g.append(el('line', { x1: Math.sin(a) * l0, y1: -Math.cos(a) * l0, x2: Math.sin(a) * l1, y2: -Math.cos(a) * l1, stroke: '#3a3f4b', 'stroke-width': i % 3 ? 1 : 1.8 }));
      }
      g.append(
        el('line', { x1: 0, y1: 0, x2: -7.4, y2: -4.3, stroke: DARK, 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
        el('line', { x1: 0, y1: 0, x2: 10.4, y2: -6, stroke: DARK, 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
        el('circle', { r: 1.8, fill: '#c0504d' }),
      );
    },
  },
  mirror: {
    main: '#c9a46a',
    draw(g, main) {
      g.append(
        el('ellipse', { rx: 16, ry: 21, fill: main, class: 'm' }),
        el('ellipse', { rx: 12.5, ry: 17.5, fill: '#cfe3ec', class: 'm' }),
        el('path', { d: 'M-8,-6 L2,-15 L6,-13 L-6,-1 Z M-4,4 L7,-6 L9,-3 L-2,7 Z', fill: '#fff', 'fill-opacity': 0.7 }),
      );
    },
  },
  window: {
    main: '#f3efe6',
    draw(g, main) {
      g.append(
        el('rect', { x: -20, y: -21, width: 40, height: 39, fill: main, class: 'm' }),
        el('rect', { x: -17, y: -18, width: 34, height: 33, fill: '#a9d6ef' }),
        el('ellipse', { cx: -7, cy: -9, rx: 7, ry: 3.5, fill: '#fff', 'fill-opacity': 0.9 }),
        el('ellipse', { cx: 8, cy: 4, rx: 6, ry: 3, fill: '#fff', 'fill-opacity': 0.8 }),
        el('rect', { x: -1.5, y: -18, width: 3, height: 33, fill: main }),
        el('rect', { x: -17, y: -3.5, width: 34, height: 3, fill: main }),
        el('rect', { x: -22, y: 17, width: 44, height: 4.5, fill: shade(main, -0.12), class: 'm' }),
      );
    },
  },
  web: {
    main: '#f5f5f5',
    draw(g) {
      const spokes = 8;
      const ring = (r: number) =>
        Array.from({ length: spokes }, (_, i) => {
          const a = (i * 2 * Math.PI) / spokes;
          return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
        }).join(' ');
      const attrs = { fill: 'none', stroke: 'rgb(245 245 245 / 85%)', 'stroke-width': 1 };
      for (const r of [7, 13, 19]) g.append(el('polygon', { points: ring(r), ...attrs }));
      for (let i = 0; i < spokes; i++) {
        const a = (i * 2 * Math.PI) / spokes;
        g.append(el('line', { x1: 0, y1: 0, x2: Math.cos(a) * 21, y2: Math.sin(a) * 21, ...attrs }));
      }
    },
  },
};

// ---------------------------------------------------------------------------
// Versions décorées (finitions « motif ») : le meuble garde sa couleur ; des décorations sont posées
// sur sa plus grande surface (pics, nounours, fleurs, flammes) ou flottent au-dessus (étoiles, cœurs,
// arc-en-ciel, couronne). Les petites formes sont dessinées de face, à plat sur l'écran.
// ---------------------------------------------------------------------------

const RAINBOW = ['#e0504a', '#f59e0b', '#f6d743', '#3fb56a', '#3b82f6', '#8b5cf6'];
const BEAR = '#b07a4a';
const GOLD = '#e8b82e';
/** Symbole des versions décorées (inventaire des cadres, où le modèle n'est pas dessiné). */
export const MOTIF_GLYPH: Record<string, string> = { fleurs: '🌸', coeurs: '💗', etoiles: '⭐', nounours: '🧸', pics: '🔺', arcs: '🌈', flammes: '🔥', couronne: '👑' };

const f1 = (n: number) => n.toFixed(1);
function starPoints(r: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5;
    const k = i % 2 ? r * 0.45 : r;
    return `${f1(Math.sin(a) * k)},${f1(-Math.cos(a) * k)}`;
  }).join(' ');
}
/** Petites formes centrées en (0, 0), la base vers le bas pour celles qui se posent. */
const SHAPES = {
  heart: (sz: number) => el('path', { d: `M0,${f1(sz * 0.4)} C${f1(-sz)},${f1(-sz * 0.25)} ${f1(-sz * 0.5)},${f1(-sz)} 0,${f1(-sz * 0.45)} C${f1(sz * 0.5)},${f1(-sz)} ${f1(sz)},${f1(-sz * 0.25)} 0,${f1(sz * 0.4)} Z`, fill: '#ff4f8b', class: 'm' }),
  star: (sz: number) => el('polygon', { points: starPoints(sz), fill: '#ffd23f', class: 'm' }),
  flower(sz: number, color: string) {
    const g = el('g', {});
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5;
      g.append(el('circle', { cx: f1(Math.sin(a) * sz * 0.55), cy: f1(-Math.cos(a) * sz * 0.55), r: f1(sz * 0.45), fill: color }));
    }
    g.append(el('circle', { r: f1(sz * 0.35), fill: '#ffd23f' }));
    return g;
  },
  flame(sz: number) {
    const k = sz / 10;
    const path = (s: number) => `M0,0 C${f1(-6 * s)},${f1(-3 * s)} ${f1(-6 * s)},${f1(-12 * s)} 0,${f1(-20 * s)} C${f1(1 * s)},${f1(-14 * s)} ${f1(7 * s)},${f1(-11 * s)} ${f1(5 * s)},${f1(-5 * s)} C${f1(4 * s)},${f1(-2 * s)} ${f1(2 * s)},0 0,0 Z`;
    const g = el('g', {});
    g.append(el('path', { d: path(k), fill: '#ff6a1a' }), el('path', { d: path(k * 0.55), fill: '#ffd23f' }));
    return g;
  },
  crown(sz: number) {
    const k = sz / 10;
    const g = el('g', {});
    g.append(
      el('polygon', { points: [[-10, 0], [10, 0], [11, -11], [5, -5], [0, -13], [-5, -5], [-11, -11]].map(([x, y]) => `${f1(x * k)},${f1(y * k)}`).join(' '), fill: GOLD, class: 'm' }),
      el('circle', { cx: 0, cy: f1(-3 * k), r: f1(1.8 * k), fill: '#e0504a' }),
      el('circle', { cx: f1(-6 * k), cy: f1(-2.5 * k), r: f1(1.3 * k), fill: '#3b82f6' }),
      el('circle', { cx: f1(6 * k), cy: f1(-2.5 * k), r: f1(1.3 * k), fill: '#3fb56a' }),
    );
    return g;
  },
  /** Arc-en-ciel de rayon extérieur r, posé sur deux petits nuages. */
  rainbow(r: number) {
    const g = el('g', {});
    const band = r / 9;
    RAINBOW.forEach((c, i) => {
      const rr = r - i * band;
      g.append(el('path', { d: `M${f1(-rr)},0 A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(rr)},0`, fill: 'none', stroke: c, 'stroke-width': f1(band + 0.3) }));
    });
    for (const sx of [-1, 1])
      for (const [dx, dy, cr] of [[-3, 0, 3.4], [2, -1, 4], [5.5, 0.5, 3]])
        g.append(el('circle', { cx: f1(sx * (r - band * 2.5) + dx), cy: f1(dy), r: f1(cr), fill: '#ffffff', class: 'm' }));
    return g;
  },
};

/** Forme posée au point (x, y, z) de la grille, dessinée après tout ce qui est sous elle. */
function sprite(s: Sketch, x: number, y: number, z: number, node: SVGElement, size: number) {
  const [sx, sy] = iso(x, y, z);
  const g = el('g', { transform: `translate(${f1(sx)} ${f1(sy)})` });
  g.append(node);
  s.grow(sx - size, sy - size * 2);
  s.grow(sx + size, sy + size);
  s.add({ x0: x - 0.02, x1: x + 0.02, y0: y - 0.02, y1: y + 0.02, z0: z, z1: z + size }, 0.5, g);
}

function decorate(s: Sketch, motif: string) {
  if (!s.parts.length) return;
  const top = Math.max(...s.parts.map((p) => p.b.z1));
  // Plus grande surface du dessus (siège, matelas, plateau…), où se posent les décorations.
  const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const seat = s.parts.reduce((a, p) => (area(p.b) > area(a.b) + 0.01 || (Math.abs(area(p.b) - area(a.b)) <= 0.01 && p.b.z1 > a.b.z1) ? p : a)).b;
  const [cx, cy] = [(seat.x0 + seat.x1) / 2, (seat.y0 + seat.y1) / 2];
  const [dx, dy] = [seat.x1 - seat.x0, seat.y1 - seat.y0];
  const along = (n: number) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);
  const big = dx * dy > 0.9; // meuble de 2 cases
  switch (motif) {
    case 'pics': {
      const nx = Math.max(2, Math.round(dx / 0.2));
      const ny = Math.max(2, Math.round(dy / 0.2));
      for (const a of along(nx))
        for (const b of along(ny)) {
          const [u, v] = s.local(seat.x0 + a * dx, seat.y0 + b * dy);
          s.cyl(u, v, seat.z1, 0.045, 0, 15, METAL, METAL, 0.3);
        }
      break;
    }
    case 'nounours': {
      const spots = big ? [[cx - dx * 0.22, cy - dy * 0.1], [cx + dx * 0.2, cy + dy * 0.12]] : [[cx, cy]];
      for (const [gx, gy] of spots) {
        const [u, v] = s.local(gx, gy);
        const R = 0.11 * RX;
        s.ball(u, v, seat.z1 + R, 0.11, BEAR, 0.4);
        const [hu, hv] = s.local(gx + 0.02, gy + 0.02);
        const head = s.ball(hu, hv, seat.z1 + 2 * R + 5, 0.085, BEAR, 0.6);
        const [hx, hy] = iso(gx + 0.02, gy + 0.02, seat.z1 + 2 * R + 5);
        const hr = 0.085 * RX;
        head.nodes.unshift(el('circle', { cx: f1(hx - hr * 0.75), cy: f1(hy - hr * 0.8), r: f1(hr * 0.42), fill: BEAR, class: 'm' }), el('circle', { cx: f1(hx + hr * 0.75), cy: f1(hy - hr * 0.8), r: f1(hr * 0.42), fill: BEAR, class: 'm' }));
        head.nodes.push(
          el('ellipse', { cx: f1(hx), cy: f1(hy + hr * 0.3), rx: f1(hr * 0.42), ry: f1(hr * 0.3), fill: '#e7c9a3' }),
          el('circle', { cx: f1(hx - hr * 0.35), cy: f1(hy - hr * 0.15), r: 1.1, fill: DARK }),
          el('circle', { cx: f1(hx + hr * 0.35), cy: f1(hy - hr * 0.15), r: 1.1, fill: DARK }),
          el('circle', { cx: f1(hx), cy: f1(hy + hr * 0.2), r: 1, fill: DARK }),
        );
      }
      break;
    }
    case 'fleurs':
    case 'flammes': {
      const pts: [number, number][] = big
        ? [[0.2, 0.3], [0.5, 0.7], [0.8, 0.35], [0.35, 0.8], [0.7, 0.15]]
        : [[0.3, 0.3], [0.7, 0.45], [0.4, 0.75]];
      const colors = ['#ff7eb6', '#ffffff', '#b58cff', '#ff9f43', '#7ec8ff'];
      pts.forEach(([a, b], i) =>
        motif === 'fleurs'
          ? sprite(s, seat.x0 + a * dx, seat.y0 + b * dy, seat.z1 + 1, SHAPES.flower(4.5, colors[i % colors.length]), 6)
          : sprite(s, seat.x0 + a * dx, seat.y0 + b * dy, seat.z1, SHAPES.flame(9 + (i % 2) * 3), 12),
      );
      break;
    }
    case 'etoiles':
    case 'coeurs': {
      const pts: [number, number, number][] = [[-0.25, -0.1, 14], [0.2, 0.15, 26], [0.05, -0.3, 34], [0.3, -0.25, 12]];
      for (const [ox, oy, oz] of pts.slice(0, big ? 4 : 3)) {
        const node = motif === 'etoiles' ? SHAPES.star(6) : SHAPES.heart(6);
        sprite(s, cx + ox * dx, cy + oy * dy, top + oz, node, 7);
      }
      break;
    }
    case 'arcs':
      sprite(s, cx, cy, top + 6, SHAPES.rainbow(big ? 34 : 24), big ? 36 : 26);
      break;
    case 'couronne':
      sprite(s, cx, cy, top + 8, SHAPES.crown(11), 14);
      break;
  }
}

/** Décorations d'un objet mural (ou d'un cadre) de demi-largeur hw et demi-hauteur hh, centré en (0, 0). */
export function wallDecor(item: string, hw: number, hh: number): SVGGElement | null {
  const motif = finishOf(item);
  if (!motif.motif) return null;
  const g = el('g', { class: 'iso-deco' });
  const put = (x: number, y: number, node: SVGElement) => {
    const t = el('g', { transform: `translate(${f1(x)} ${f1(y)})` });
    t.append(node);
    g.append(t);
  };
  switch (motif.id) {
    case 'pics': {
      const n = Math.max(3, Math.round((2 * hw) / 7));
      const step = (2 * hw) / n;
      for (let i = 0; i < n; i++)
        for (const side of [-1, 1]) {
          const x = -hw + step * (i + 0.5);
          const y = side * hh;
          g.append(el('polygon', { points: `${f1(x - step * 0.4)},${f1(y)} ${f1(x + step * 0.4)},${f1(y)} ${f1(x)},${f1(y + side * 6)}`, fill: METAL, class: 'm' }));
        }
      break;
    }
    case 'nounours': {
      const bx = hw * 0.62;
      const by = hh - 1;
      g.append(
        el('circle', { cx: f1(bx), cy: f1(by - 4), r: 4.6, fill: BEAR, class: 'm' }),
        el('circle', { cx: f1(bx - 3.2), cy: f1(by - 12.6), r: 1.8, fill: BEAR, class: 'm' }),
        el('circle', { cx: f1(bx + 3.2), cy: f1(by - 12.6), r: 1.8, fill: BEAR, class: 'm' }),
        el('circle', { cx: f1(bx), cy: f1(by - 10.5), r: 3.6, fill: BEAR, class: 'm' }),
        el('ellipse', { cx: f1(bx), cy: f1(by - 9.4), rx: 1.6, ry: 1.1, fill: '#e7c9a3' }),
        el('circle', { cx: f1(bx - 1.3), cy: f1(by - 11.4), r: 0.6, fill: DARK }),
        el('circle', { cx: f1(bx + 1.3), cy: f1(by - 11.4), r: 0.6, fill: DARK }),
      );
      break;
    }
    case 'fleurs':
      for (const [sx, sy, c] of [[-1, -1, '#ff7eb6'], [1, 1, '#b58cff'], [1, -1, '#ffffff']] as const) put(sx * hw, sy * hh, SHAPES.flower(3.6, c));
      break;
    case 'coeurs':
    case 'etoiles':
      for (const [sx, sy] of [[-1, -1], [1, -0.4], [-0.7, 1]]) put(sx * hw, sy * hh, motif.id === 'coeurs' ? SHAPES.heart(4.5) : SHAPES.star(4.5));
      break;
    case 'flammes':
      for (const x of [-hw * 0.6, 0, hw * 0.6]) put(x, -hh, SHAPES.flame(7));
      break;
    case 'arcs':
      put(0, -hh + 2, SHAPES.rainbow(Math.min(hw * 0.8, 18)));
      break;
    case 'couronne':
      put(0, -hh + 1, SHAPES.crown(8));
      break;
  }
  return g;
}

const mainOf = (item: string, fallback: string) => FINISH_MAIN[finishOf(item).id] ?? fallback;
const modelClass = (item: string) => `iso-model fin-${finishOf(item).id}`;
const kind = (item: string) => item.split(':')[0];

function sketch(item: string, r: number): Sketch {
  const model = FLOOR[kind(item)];
  const { w, h } = footprint(item, 0);
  const s = new Sketch(w, h, r, mainOf(item, model?.main ?? '#9aa0ae'));
  if (model) model.draw(s);
  else s.cube(0.2, 0.2, 0, 0.6, 0.6, 40, s.main);
  const fin = finishOf(item);
  if (fin.motif) decorate(s, fin.id);
  return s;
}

// ---------------------------------------------------------------------------
// Meubles personnalisables : la photo choisie recouvre tout le meuble en papier peint. Chaque forme
// reçoit par-dessus une copie remplie de la photo répétée, en « multiplication » : le meuble est
// blanc, donc chaque face garde son ombrage (dessus clair, côtés plus sombres) et les détails sombres
// restent sombres. Sans photo (inventaire, caisses), un damier coloré annonce le motif à venir.
// ---------------------------------------------------------------------------

let wallpapers = 0;
export function wallpaper(g: SVGElement, url: string | null, tile: number) {
  const id = `ap-wp-${++wallpapers}`;
  const pattern = el('pattern', { id, patternUnits: 'userSpaceOnUse', width: tile, height: tile });
  if (url) pattern.append(el('image', { href: url, width: tile, height: tile, preserveAspectRatio: 'xMidYMid slice' }));
  else
    ['#ff7eb6', '#7ec8ff', '#ffd23f', '#3fb56a'].forEach((fill, i) =>
      pattern.append(el('rect', { x: (i % 2) * (tile / 2), y: Math.floor(i / 2) * (tile / 2), width: tile / 2, height: tile / 2, fill })),
    );
  const defs = el('defs');
  defs.append(pattern);
  for (const n of [...g.querySelectorAll('.m')]) {
    const copy = n.cloneNode(false) as SVGElement;
    copy.setAttribute('fill', `url(#${id})`);
    copy.setAttribute('class', 'wp');
    n.after(copy);
  }
  g.prepend(defs);
}
const isPerso = (item: string) => finishOf(item).id === 'perso';

/** Meuble du sol posé en (x, y) avec l'orientation r, dans le repère de iso() ; `photo` : papier peint. */
export function floorModel(item: string, x: number, y: number, r = 0, photo: string | null = null): SVGGElement {
  // Le placement est sur un groupe à part : les animations CSS des finitions (transform) ne le touchent pas.
  const [dx, dy] = iso(x, y);
  const g = el('g', { transform: `translate(${dx.toFixed(1)} ${dy.toFixed(1)})` });
  const model = sketch(item, r).build(modelClass(item));
  if (isPerso(item)) wallpaper(model, photo, 34);
  g.append(model);
  return g;
}

// ---------------------------------------------------------------------------
// Équipements spéciaux des pièces de luxe (SPECIALS) : pas des meubles, posés à une place fixe.
// ---------------------------------------------------------------------------

const JAGER = '#1d3b24'; // bouteille vert sombre, étiquette orange
const FIXTURES: Record<string, (s: Sketch) => void> = {
  // Comptoir 3 × 1 contre le mur, la tireuse (3 bouteilles tête en bas) et des shots dessus.
  jager(s) {
    const bar = s.cube(0.02, 0.08, 0, 2.96, 0.8, 70, '#6b3f22');
    s.front(bar, 0.88, 0.02, 2.98, 8, 14, '#3e2414');
    s.front(bar, 0.88, 0.02, 2.98, 56, 62, '#c9a84c');
    s.cube(0, 0.04, 70, 3, 0.88, 6, '#2b1a10');
    const machine = s.cube(0.9, 0.16, 76, 1.2, 0.46, 46, '#15171a');
    s.front(machine, 0.62, 1.0, 2.0, 82, 116, '#0b0c0e');
    s.front(machine, 0.62, 1.38, 1.62, 96, 108, '#f07a1a');
    for (const u of [1.12, 1.5, 1.88]) {
      s.cyl(u, 0.38, 122, 0.06, 0.13, 46, JAGER, '#24452c');
      s.cyl(u, 0.38, 138, 0.135, 0.135, 12, '#f07a1a');
    }
    s.cube(1.44, 0.6, 96, 0.12, 0.14, 8, METAL);
    for (const u of [0.3, 0.5, 2.4, 2.6]) s.cyl(u, 0.6, 76, 0.07, 0.08, 14, '#e8dcc2', '#7a3b12');
  },
  // Coffre-fort 2 × 2 : porte blindée avec sa roue, lingots posés dessus.
  coffre(s) {
    const body = s.cube(0.12, 0.12, 0, 1.76, 1.6, 130, '#4a5260');
    s.front(body, 1.72, 0.28, 1.72, 14, 118, '#5c6676');
    s.front(body, 1.72, 0.34, 1.66, 20, 112, '#3a404b');
    s.front(body, 1.72, 0.92, 1.08, 40, 92, '#c9a84c');
    s.front(body, 1.72, 0.72, 1.28, 60, 72, '#c9a84c');
    s.front(body, 1.72, 1.5, 1.58, 54, 78, METAL);
    for (const [u, v, z] of [[0.3, 0.5, 130], [0.85, 0.5, 130], [0.55, 0.5, 142], [1.2, 0.9, 130]] as const) s.cube(u, v, z, 0.5, 0.26, 12, '#e8b82e');
  },
  // Jacuzzi 2 × 2 : margelle dorée, eau turquoise et bulles.
  jacuzzi(s) {
    const tub = s.cube(0.04, 0.04, 0, 1.92, 1.92, 44, '#e7e1d6');
    s.front(tub, 1.96, 0.04, 1.96, 34, 40, '#e8b82e');
    s.top(tub, 44, 0.04, 0.04, 1.96, 1.96, '#e8b82e');
    s.top(tub, 44, 0.2, 0.2, 1.8, 1.8, '#3fc6d6');
    s.top(tub, 44, 0.5, 0.5, 1.5, 1.5, '#7fe0ea', { 'fill-opacity': 0.7 });
    for (const [u, v] of [[0.6, 0.7], [1.3, 0.6], [1.0, 1.2], [0.5, 1.4], [1.5, 1.4]] as const) s.ball(u, v, 48, 0.06, '#ffffff');
  },
};

/** Équipement spécial `id` (emprise w × h) posé en (x, y), dans le repère de iso(). */
export function fixtureModel(id: string, x: number, y: number, w: number, h: number): SVGGElement {
  const [dx, dy] = iso(x, y);
  const g = el('g', { transform: `translate(${dx.toFixed(1)} ${dy.toFixed(1)})` });
  const s = new Sketch(w, h, 0, '#9aa0ae');
  (FIXTURES[id] ?? ((k: Sketch) => k.cube(0.2, 0.2, 0, w - 0.4, h - 0.4, 40, k.main)))(s);
  g.append(s.build('iso-model'));
  return g;
}

/** Objet mural, dessiné de face autour de (0, 0). */
export function wallModel(item: string, photo: string | null = null): SVGGElement {
  const g = el('g', { class: modelClass(item) });
  const model = WALL[kind(item)];
  if (model) model.draw(g, mainOf(item, model.main));
  const decor = wallDecor(item, 22, 22);
  if (decor) g.append(decor);
  if (isPerso(item)) wallpaper(g, photo, 16);
  return g;
}

/** Vignette autonome (inventaire, caisses, boutique). */
export function modelIcon(item: string): SVGSVGElement {
  const svg = el('svg', { 'aria-hidden': 'true' });
  if (baseOf(item)?.place === 'wall' || WALL[kind(item)]) {
    svg.setAttribute('viewBox', '-24 -24 48 48');
    svg.append(wallModel(item));
    return svg;
  }
  const s = sketch(item, 0);
  const g = s.build(modelClass(item));
  if (isPerso(item)) wallpaper(g, null, 34);
  const pad = 4;
  const [w, h] = [s.maxX - s.minX + 2 * pad, s.maxY - s.minY + 2 * pad];
  const side = Math.max(w, h);
  svg.setAttribute('viewBox', [s.minX - pad - (side - w) / 2, s.minY - pad - (side - h) / 2, side, side].map((n) => n.toFixed(1)).join(' '));
  svg.append(g);
  return svg;
}
