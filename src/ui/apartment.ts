import { isTyping, pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { isAdmin } from '../net/admin';
import { serverNow } from '../net/serverClock';
import {
  artworks,
  baseOf,
  buyRoom,
  buySpecial,
  capHours,
  CLEAN_TASKS,
  cleanApartment,
  collectIncome,
  covers,
  CLEAN_RATE,
  finishOf,
  fitsIn,
  footprint,
  incomeMult,
  itemIncome,
  itemName,
  loadApartment,
  myFurniture,
  ownedPhotos,
  pending,
  ROOM_COSTS,
  roomCost,
  roomOf,
  ROOMS,
  saveLayout,
  sellFurniture,
  sellPrice,
  specialOf,
  takesPhoto,
  WALL_ROWS,
  zoneDims,
  type ApartmentState,
  type Artwork,
  type Owned,
  type Placed,
  type Room,
  type RoomLayout,
  type Zone,
} from '../net/apartment';
import { ensureAccount } from '../net/auth';
import { onIdleIncome } from '../net/idle';
import { nameEl } from '../net/cosmetics';
import { formatPoints, refreshWallet } from '../net/points';
import { getSupabase } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { fixtureModel, floorModel, iso, modelIcon, MOTIF_GLYPH, TH, TW, wallDecor, wallModel, wallpaper } from './furnitureArt';
import { page } from './layout';

/** Un meuble en HTML (inventaire, caisses) : son modèle et sa finition, ou la photo pour un cadre. */
export function furnitureEl(item: string, art?: Artwork): HTMLElement {
  const base = baseOf(item);
  const fin = finishOf(item);
  if (base?.id === 'frame') {
    return h(
      'span',
      { class: `ap-frame fin-${fin.id}`, title: art?.title ?? itemName(item) },
      art ? h('img', { src: art.url, alt: art.title, loading: 'lazy', draggable: 'false' }) : h('span', { class: 'ap-frame-empty' }, '🖼️'),
      fin.motif ? h('span', { class: 'ap-motif', 'aria-hidden': 'true' }, MOTIF_GLYPH[fin.id] ?? '') : '',
    );
  }
  return h('span', { class: 'ap-glyph ap-model', title: itemName(item) }, modelIcon(item));
}

// ---------------------------------------------------------------------------
// Vue isométrique (SVG) : sol en losanges, deux murs du fond, meubles triés par profondeur.
// ---------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
const WH = 190; // hauteur des murs
const PAD = 24;
const SKEW = (Math.atan(0.5) * 180) / Math.PI; // 26,57° : pente des murs
const SLOT_W = TW / 2; // largeur d'un emplacement de mur, dans le plan du mur
const SLOT_H = WH * 0.42; // hauteur d'un emplacement de mur
const MAX_ZOOM = 4;

const pts = (...p: (readonly [number, number])[]) => p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) e.append(c);
  return e;
}

/** Projection d'une pièce : taille de la vue, points du sol et emplacements de mur. */
interface Geom {
  room: Room;
  ox: number; // coin du fond de la pièce
  oy: number;
  vw: number;
  vh: number;
  /** Point du sol aux coordonnées de grille (x, y), éventuellement surélevé de `z`. */
  P(x: number, y: number, z?: number): readonly [number, number];
  /** Emplacement de mur : x < d = mur de gauche (le long de y), sinon mur de droite (le long de x). */
  slot(x: number, row: number): { poly: string; cx: number; cy: number; skew: number };
}

function geometry(room: Room): Geom {
  const ox = room.d * (TW / 2) + PAD;
  const oy = WH + PAD;
  const P = (x: number, y: number, z = 0) => {
    const [a, b] = iso(x, y, z);
    return [ox + a, oy + b] as const;
  };
  return {
    room,
    ox,
    oy,
    vw: ((room.w + room.d) * TW) / 2 + 2 * PAD,
    vh: oy + ((room.w + room.d) * TH) / 2 + PAD + 20,
    P,
    slot(x, row) {
      const left = x < room.d;
      const i = left ? x : x - room.d;
      const a = left ? P(0, i) : P(i, 0);
      const b = left ? P(0, i + 1) : P(i + 1, 0);
      const [lo, hi] = row === 0 ? [WH * 0.52, WH * 0.94] : [WH * 0.1, WH * 0.5];
      const poly = pts([a[0], a[1] - lo], [b[0], b[1] - lo], [b[0], b[1] - hi], [a[0], a[1] - hi]);
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2 - (lo + hi) / 2;
      return { poly, cx, cy, skew: left ? -SKEW : SKEW };
    },
  };
}

// Désordre du début, dans l'entrée : chaque tâche de nettoyage en retire une partie.
const BOXES: [number, number][] = [[1, 1], [2, 1], [4, 1], [5, 3], [2, 4], [0, 3]];
const TRASH: [number, number][] = [[4, 3], [1, 3], [3, 2]];
const WEBS: [number, number][] = [[0, 0], [4, 0], [5, 0], [10, 0], [8, 1]];
const DUST: [number, number][] = [[1, 0], [3, 1], [5, 2], [0, 2], [2, 3], [4, 4], [1, 4], [5, 0]];
const BROKEN: [number, number][] = [[2, 0], [4, 2], [1, 2], [3, 4], [5, 4], [0, 1]];
const STAINS: [number, number][] = [[1, 1], [3, 0], [7, 1], [10, 0], [8, 0]]; // pas sur les portes (2, 6, 9)

interface Scene {
  layout: RoomLayout;
  clean: number; // tâches de nettoyage faites (toutes pour les pièces achetées)
  photos: Artwork[];
  editing: boolean;
  isOpen(room: string): boolean; // pièce débloquée : sa porte s'ouvre
  fixture: { id: string; name: string; x: number; y: number; w: number; h: number; owned: boolean } | null; // équipement spécial
  onFixture(): void;
  onDoor(room: string): void;
  onCell(zone: Zone, x: number, y: number): void;
  onHover(zone: Zone, x: number, y: number): void;
}

/** Curseur et meuble en main : redessinés seuls au survol, sans toucher au reste de la pièce. */
interface Overlay {
  draw(cursor: { zone: Zone; x: number; y: number } | null, ghost: { item: string; r: number; ok: boolean } | null): void;
}

function drawScene(svg: SVGSVGElement, g: Geom, s: Scene): Overlay {
  const { P } = g;
  const W = g.room.w;
  const D = g.room.d;
  const clean = s.clean;
  const parts: SVGElement[] = [];
  const dirtyWalls = clean < 6;

  // Murs (le gauche plus clair, le droit plus sombre : la lumière vient de la gauche), joints et plinthe
  const top = P(0, 0, WH);
  parts.push(el('polygon', { points: pts(P(0, 0), P(0, D), P(0, D, WH), top), class: 'iso-wall left' + (dirtyWalls ? ' dirty' : '') }));
  parts.push(el('polygon', { points: pts(P(0, 0), P(W, 0), P(W, 0, WH), top), class: 'iso-wall right' + (dirtyWalls ? ' dirty' : '') }));
  for (let i = 1; i < D; i++) parts.push(el('line', { x1: P(0, i)[0], y1: P(0, i)[1], x2: P(0, i, WH)[0], y2: P(0, i, WH)[1], class: 'iso-wall-seam' }));
  for (let i = 1; i < W; i++) parts.push(el('line', { x1: P(i, 0)[0], y1: P(i, 0)[1], x2: P(i, 0, WH)[0], y2: P(i, 0, WH)[1], class: 'iso-wall-seam' }));
  if (dirtyWalls) {
    for (const [x, row] of STAINS) {
      const w = g.slot(x, row);
      parts.push(el('ellipse', { cx: w.cx, cy: w.cy, rx: 26, ry: 18, class: 'iso-stain', transform: `rotate(${w.skew} ${w.cx} ${w.cy})` }));
    }
  }
  parts.push(el('polyline', { points: pts(P(0, D, 8), P(0, 0, 8), P(W, 0, 8)), class: 'iso-baseboard' }));

  // Sol
  for (let y = 0; y < D; y++)
    for (let x = 0; x < W; x++) {
      const broken = clean < 5 && BROKEN.some(([a, b]) => a === x && b === y);
      const tile = el('polygon', {
        points: pts(P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)),
        class: `iso-tile ${(x + y) % 2 ? 'b' : 'a'}${broken ? ' broken' : ''}${s.editing ? ' edit' : ''}`,
        'data-x': x,
        'data-y': y,
      });
      tile.addEventListener('click', () => s.onCell('floor', x, y));
      tile.addEventListener('mouseenter', () => s.onHover('floor', x, y));
      parts.push(tile);
      if (broken) {
        const [cx, cy] = P(x + 0.5, y + 0.5);
        parts.push(el('path', { d: `M${cx - 18},${cy - 4} l10,6 l6,-8 l9,9`, class: 'iso-crack' }));
      }
    }
  if (clean < 4) {
    for (const [x, y] of DUST) {
      const [cx, cy] = P(x + 0.5, y + 0.5);
      parts.push(el('ellipse', { cx, cy, rx: 34, ry: 15, class: 'iso-dust' }));
    }
  }

  // Emplacements de mur (cibles) et objets muraux, inclinés dans le plan de leur mur
  for (let row = 0; row < WALL_ROWS; row++)
    for (let x = 0; x < D + W; x++) {
      const w = g.slot(x, row);
      const photo = !s.editing && s.layout.wall.some((p) => p.art && covers(p, x, row));
      const slot = el('polygon', { points: w.poly, class: `iso-slot${s.editing ? ' edit' : ''}${photo ? ' photo' : ''}`, 'data-x': x, 'data-y': row });
      slot.addEventListener('click', () => s.onCell('wall', x, row));
      slot.addEventListener('mouseenter', () => s.onHover('wall', x, row));
      parts.push(slot);
    }
  // Un emplacement de mur mesure SLOT_W = 48 de large et SLOT_H ≈ 80 de haut (dans le plan du mur) :
  // les petits objets y tiennent dans les 4 orientations (dessinés dans ±22) ; un cadre occupe
  // toute son emprise (2 emplacements : 96 × 80) et ne tourne pas, pour que la photo reste droite.
  const wallItem = (p: { i: string; x: number; y: number; r?: number; art?: number }, ghost = false) => {
    const f = footprint(p.i);
    const a = g.slot(p.x, p.y);
    const b = g.slot(p.x + f.w - 1, p.y + f.h - 1);
    const [cx, cy] = [(a.cx + b.cx) / 2, (a.cy + b.cy) / 2];
    const frame = baseOf(p.i)?.id === 'frame';
    const r = frame ? 0 : (p.r ?? 0);
    const node = el('g', {
      transform: `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) skewY(${a.skew}) rotate(${r * 90})`,
      class: `iso-item${ghost ? ' ghost' : ''}`,
      'data-key': `wall:${p.x},${p.y},${r}`,
    });
    if (frame) {
      const fw = f.w * SLOT_W - 6;
      const fh = f.h * SLOT_H - 8;
      const art = s.photos.find((q) => q.id === p.art);
      const box = el('g', { class: `iso-frame fin-${finishOf(p.i).id}` });
      box.append(el('rect', { x: -fw / 2, y: -fh / 2, width: fw, height: fh, class: `iso-frame-border${finishOf(p.i).id === 'perso' ? ' m' : ''}` }));
      const inner = { x: -fw / 2 + 5, y: -fh / 2 + 5, width: fw - 10, height: fh - 10 };
      if (art) box.append(el('image', { href: art.url, ...inner, preserveAspectRatio: 'xMidYMid slice' }));
      else box.append(el('rect', { ...inner, class: 'iso-frame-empty' }));
      const decor = wallDecor(p.i, fw / 2, fh / 2);
      if (decor) box.append(decor);
      if (finishOf(p.i).id === 'perso') wallpaper(box, art?.url ?? null, 16); // le cadre aussi, de la même photo
      node.append(box);
    } else {
      node.append(wallModel(p.i, s.photos.find((q) => q.id === p.art)?.url ?? null));
    }
    return node;
  };
  for (const p of s.layout.wall) parts.push(wallItem(p));

  // Portes vers les autres pièces : toute la hauteur d'une colonne de mur, posées sur le sol.
  for (const dr of g.room.doors) {
    const open = s.isOpen(dr.to);
    const target = roomOf(dr.to);
    const left = dr.x < D;
    const i = left ? dr.x : dr.x - D;
    const a = left ? P(0, i) : P(i, 0);
    const b = left ? P(0, i + 1) : P(i + 1, 0);
    const door = el(
      'g',
      { transform: `translate(${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}) skewY(${left ? -SKEW : SKEW})`, class: `iso-door${open ? '' : ' locked'}` },
      el('title', {}, open ? `Aller : ${target.name}` : `${target.name} : porte fermée`),
      el('rect', { x: -21, y: -152, width: 42, height: 152, class: 'iso-door-frame' }),
      el('rect', { x: -17, y: -148, width: 34, height: 148, class: 'iso-door-leaf' }),
      el('rect', { x: -12, y: -140, width: 24, height: 52, class: 'iso-door-panel' }),
      el('rect', { x: -12, y: -78, width: 24, height: 66, class: 'iso-door-panel' }),
      el('circle', { cx: 11, cy: -80, r: 2.6, class: 'iso-door-knob' }),
      el('text', { x: 0, y: -160, class: 'iso-door-sign' }, open ? target.glyph : '🔒'),
    );
    door.addEventListener('click', () => s.onDoor(dr.to));
    parts.push(door);
  }
  if (clean < 3) for (const [x, row] of WEBS) parts.push(wallItem({ i: 'web', x, y: row }));

  // Objets du sol, du fond vers l'avant (le plus proche est dessiné en dernier)
  const sprites: { depth: number; node: SVGElement }[] = [];
  const floorItem = (item: string, x: number, y: number, r = 0, ghost = false, art?: number) => {
    const f = footprint(item, r);
    const [cx, cy] = P(x + f.w / 2, y + f.h / 2);
    // Le modèle est construit dans son emprise : il ne déborde jamais de ses cases, seulement vers le haut.
    const node = el('g', { class: `iso-item${ghost ? ' ghost' : ''}`, 'data-key': `floor:${x},${y},${r}` });
    // Ombre : l'emprise elle-même, resserrée vers son centre.
    const shrink = (gx: number, gy: number) => {
      const [px, py] = P(gx, gy);
      return [cx + (px - cx) * 0.72, cy + (py - cy) * 0.72] as const;
    };
    node.append(el('polygon', { points: pts(shrink(x, y), shrink(x + f.w, y), shrink(x + f.w, y + f.h), shrink(x, y + f.h)), class: 'iso-shadow' }));
    const model = floorModel(item, x, y, r, s.photos.find((q) => q.id === art)?.url ?? null);
    model.setAttribute('transform', `translate(${g.ox} ${g.oy}) ${model.getAttribute('transform')}`);
    node.append(model);
    sprites.push({ depth: x + f.w + y + f.h + (ghost ? 0.01 : 0), node });
    return node;
  };
  for (const p of s.layout.floor) floorItem(p.i, p.x, p.y, p.r ?? 0, false, p.art);
  // Équipement spécial de la pièce : grisé et cadenassé tant qu'il n'est pas acheté.
  if (s.fixture) {
    const fx = s.fixture;
    const node = el('g', { class: `iso-item iso-fixture${fx.owned ? '' : ' locked'}` }, el('title', {}, fx.owned ? fx.name : `${fx.name} : à débloquer`));
    const model = fixtureModel(fx.id, fx.x, fx.y, fx.w, fx.h);
    model.setAttribute('transform', `translate(${g.ox} ${g.oy}) ${model.getAttribute('transform')}`);
    node.append(model);
    if (!fx.owned) {
      const [cx, cy] = P(fx.x + fx.w / 2, fx.y + fx.h / 2, 150);
      node.append(el('text', { x: cx, y: cy, class: 'iso-fixture-lock' }, '🔒'));
    }
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      s.onFixture();
    });
    sprites.push({ depth: fx.x + fx.w + fx.y + fx.h, node });
  }
  if (clean < 1) for (const [x, y] of BOXES) floorItem('box', x, y);
  if (clean < 2) for (const [x, y] of TRASH) floorItem('trash', x, y);
  sprites.sort((a, b) => a.depth - b.depth).forEach((sp) => parts.push(sp.node));
  sprites.length = 0;
  const overlay = el('g', { class: 'iso-overlay' });
  parts.push(overlay);
  svg.replaceChildren(...parts);

  return {
    draw(cursor, ghost) {
      const out: SVGElement[] = [];
      if (cursor?.zone === 'floor') {
        const { x, y } = cursor;
        out.push(el('polygon', { points: pts(P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)), class: 'iso-cursor' }));
        if (ghost) floorItem(ghost.item, x, y, ghost.r, true).classList.toggle('bad', !ghost.ok);
        out.push(...sprites.map((sp) => sp.node));
        sprites.length = 0;
      } else if (cursor?.zone === 'wall') {
        out.push(el('polygon', { points: g.slot(cursor.x, cursor.y).poly, class: 'iso-cursor' }));
        if (ghost) {
          const node = wallItem({ i: ghost.item, x: cursor.x, y: cursor.y, r: ghost.r }, true);
          node.classList.toggle('bad', !ghost.ok);
          out.push(node);
        }
      }
      overlay.replaceChildren(...out);
    },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** `#/appart` (le mien) ou `#/appart/<id>` (celui d'un autre). Pour l'instant réservé aux admins. */
export function apartmentView(root: HTMLElement, [ownerParam]: string[]): () => void {
  const content = page(root, 'Appart');
  content.classList.add('wide');
  const wrap = h('div', { class: 'appart' }, h('p', { class: 'muted' }, 'Chargement…'));
  content.append(wrap);
  let disposed = false;
  const offs: (() => void)[] = [];

  let me = '';
  let owner = '';
  let ownerName = '';
  let state: ApartmentState = { layout: {}, rooms: ['entree'], specials: [], cleanStep: 0, rate: 0, banked: 0, lastTick: serverNow() };
  let owned: Owned[] = [];
  let photos: Artwork[] = [];
  let unlockedPhotos = new Set<number>(); // photos débloquées (caisse souvenirs)
  let admin = false; // un admin peut accrocher toutes les photos
  const pickable = () => photos.filter((a) => admin || unlockedPhotos.has(a.id));
  let room = 'entree';
  let geom = geometry(roomOf(room));
  let editing = false;
  let hand: Owned | null = null;
  let handRot = 0; // orientation du meuble en main
  let handArt: number | undefined; // sa photo (cadre, meuble personnalisable)
  let cursor: { zone: Zone; x: number; y: number } = { zone: 'floor', x: 2, y: 2 };
  let status = '';
  let saveTimer: number | undefined;
  let unsaved = false;
  let pickingPhoto: Placed | null = null;
  let busy = false;
  let lightbox: HTMLElement | null = null;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'iso-room');
  const side = h('aside', { class: 'ap-side card' });
  const statusEl = h('p', { class: 'status' });
  const header = h('div', { class: 'ap-head' });
  const income = h('div', { class: 'ap-income' });
  const tabs = h('div', { class: 'ap-rooms', role: 'tablist' });

  const mine = () => owner === me;
  const unlocked = (id = room) => state.rooms.includes(id);
  const layout = (): RoomLayout => state.layout[room] ?? { floor: [], wall: [] };
  const placedAll = () => Object.values(state.layout).flatMap((l) => [...l.floor, ...l.wall]);
  const sizeOf = (item: string) => footprint(item);
  const occupant = (zone: Zone, x: number, y: number) => layout()[zone].find((p) => covers(p, x, y));
  const fits = (item: string, zone: Zone, x: number, y: number, r = handRot) => fitsIn(layout()[zone], room, zone, item, r, x, y);
  const isFrame = (item: string) => baseOf(item)?.id === 'frame';

  // -------------------------------------------------------------------------
  // Zoom : molette ou pincement autour du point visé, + / − / 0, et glisser pour se déplacer.
  // -------------------------------------------------------------------------

  const view = { z: 1, cx: 0, cy: 0 };
  const zoomLabel = h('button', { class: 'field', type: 'button', title: 'Taille normale (0)' });
  const applyView = () => {
    const vw = geom.vw / view.z;
    const vh = geom.vh / view.z;
    view.cx = Math.max(vw / 2, Math.min(geom.vw - vw / 2, view.cx));
    view.cy = Math.max(vh / 2, Math.min(geom.vh - vh / 2, view.cy));
    svg.setAttribute('viewBox', [view.cx - vw / 2, view.cy - vh / 2, vw, vh].map((n) => n.toFixed(1)).join(' '));
    svg.classList.toggle('zoomed', view.z > 1);
    zoomLabel.textContent = `${Math.round(view.z * 100)} %`;
  };
  const resetView = () => {
    view.z = 1;
    view.cx = geom.vw / 2;
    view.cy = geom.vh / 2;
    applyView();
  };
  /** Change le zoom en gardant immobile le point (fx, fy) de la pièce (par défaut, le centre de la vue). */
  const zoomTo = (z: number, fx = view.cx, fy = view.cy) => {
    z = Math.max(1, Math.min(MAX_ZOOM, z));
    view.cx = fx - ((fx - view.cx) * view.z) / z;
    view.cy = fy - ((fy - view.cy) * view.z) / z;
    view.z = z;
    applyView();
  };
  const toRoom = (clientX: number, clientY: number) => {
    const rect = svg.getBoundingClientRect();
    const vw = geom.vw / view.z;
    const vh = geom.vh / view.z;
    return [view.cx - vw / 2 + ((clientX - rect.left) / rect.width) * vw, view.cy - vh / 2 + ((clientY - rect.top) / rect.height) * vh] as const;
  };
  svg.addEventListener(
    'wheel',
    (e) => {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (view.z <= 1 && dy > 0) return; // déjà au plus loin : la page défile normalement
      e.preventDefault();
      zoomTo(view.z * Math.exp(-dy * 0.0015), ...toRoom(e.clientX, e.clientY));
    },
    { passive: false },
  );
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt = { x: 0, y: 0 };
  let dragged = false;
  let pinch: { d: number; z: number } | null = null;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = { x: e.clientX, y: e.clientY };
      dragged = false;
    } else if (pointers.size === 2) pinch = { d: spread(), z: view.z };
  });
  const onPointerMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size >= 2) {
      p.x = e.clientX;
      p.y = e.clientY;
      dragged = true;
      const [a, b] = [...pointers.values()];
      if (pinch) zoomTo((pinch.z * spread()) / pinch.d, ...toRoom((a.x + b.x) / 2, (a.y + b.y) / 2));
      return;
    }
    if (!dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) return;
    dragged = true;
    const k = geom.vw / view.z / svg.getBoundingClientRect().width; // unités de la pièce par pixel
    view.cx -= (e.clientX - p.x) * k;
    view.cy -= (e.clientY - p.y) * k;
    p.x = e.clientX;
    p.y = e.clientY;
    applyView();
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  offs.push(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  });
  // Après un glissement, le clic qui suit ne pose ni ne reprend rien.
  svg.addEventListener(
    'click',
    (e) => {
      if (dragged) e.stopPropagation();
      dragged = false;
    },
    true,
  );
  const zoomBtn = (label: string, title: string, f: () => void) => {
    const b = h('button', { class: 'field', type: 'button', title }, label);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', f);
    return b;
  };
  zoomLabel.addEventListener('mousedown', (e) => e.preventDefault());
  zoomLabel.addEventListener('click', resetView);
  const zoomBar = h(
    'div',
    { class: 'ap-zoom' },
    zoomBtn('−', 'Dézoomer (−)', () => zoomTo(view.z / 1.25)),
    zoomLabel,
    zoomBtn('+', 'Zoomer (+)', () => zoomTo(view.z * 1.25)),
  );

  // -------------------------------------------------------------------------
  // Photo en grand
  // -------------------------------------------------------------------------

  const closePhoto = () => {
    lightbox?.remove();
    lightbox = null;
  };
  const showPhoto = (art: Artwork) => {
    closePhoto();
    lightbox = h('div', { class: 'ap-lightbox', role: 'dialog', title: 'Fermer' }, h('figure', {}, h('img', { src: art.url, alt: art.title }), h('figcaption', {}, art.title)));
    lightbox.addEventListener('click', closePhoto);
    document.body.append(lightbox);
  };
  offs.push(closePhoto);

  // -------------------------------------------------------------------------
  // Aménagement
  // -------------------------------------------------------------------------

  const reloadState = async () => {
    const fresh = await loadApartment(owner);
    // Garde l'aménagement affiché s'il reste des changements à envoyer.
    state = unsaved ? { ...fresh, layout: { ...fresh.layout, ...state.layout } } : fresh;
  };

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    status = 'Modifications…';
    unsaved = true;
    saveTimer = window.setTimeout(async () => {
      unsaved = false;
      try {
        await saveLayout(state.layout);
        await reloadState();
        status = 'Enregistré.';
      } catch (e) {
        status = (e as Error).message;
      }
      render();
    }, 700);
  };

  // Vente du meuble en main (67 % du prix de base) : un 1er appui arme, le 2e vend.
  let sellArmed = false;
  const sellHand = async () => {
    if (!hand || busy) return;
    if (!sellArmed) {
      sellArmed = true;
      return render();
    }
    const o = hand;
    busy = true;
    sellArmed = false;
    try {
      // Les changements en attente d'abord : le serveur doit voir le meuble rangé.
      if (unsaved) {
        clearTimeout(saveTimer);
        unsaved = false;
        await saveLayout(state.layout);
      }
      const r = await sellFurniture(o.id);
      owned = owned.filter((x) => x.id !== o.id);
      hand = null;
      handArt = undefined;
      status = `${itemName(o.item_id)} vendu : +${formatPoints(r.price)} points.`;
      blip(660);
      void refreshWallet();
    } catch (e) {
      status = (e as Error).message;
    } finally {
      busy = false;
      render();
    }
  };

  const setLayout = (l: RoomLayout) => {
    state = { ...state, layout: { ...state.layout, [room]: l } };
    scheduleSave();
    render();
  };

  const activate = (zone: Zone, x: number, y: number) => {
    if (!editing) {
      // Hors aménagement, cliquer un cadre montre sa photo en grand.
      const art = photos.find((a) => a.id === occupant(zone, x, y)?.art);
      if (art) showPhoto(art);
      return;
    }
    cursor = { zone, x, y };
    if (hand) {
      if (!fits(hand.item_id, zone, x, y)) return;
      const entry: Placed = { o: hand.id, i: hand.item_id, x, y, ...(handRot ? { r: handRot } : {}), ...(handArt ? { art: handArt } : {}) };
      // Un cadre ou un meuble personnalisable garde sa photo quand on le déplace ; sinon, on la choisit.
      if (takesPhoto(hand.item_id) && !handArt && photos.length) pickingPhoto = entry;
      hand = null;
      handArt = undefined;
      setLayout({ ...layout(), [zone]: [...layout()[zone], entry] });
      return;
    }
    const p = occupant(zone, x, y);
    if (!p) return;
    hand = owned.find((o) => o.id === p.o) ?? null;
    handRot = p.r ?? 0;
    handArt = p.art;
    setLayout({ ...layout(), [zone]: layout()[zone].filter((q) => q !== p) });
  };

  /** Quart de tour : le meuble en main, sinon celui sous le curseur (s'il a la place une fois tourné). */
  const rotate = () => {
    if (!editing) return;
    const target = hand ? hand.item_id : occupant(cursor.zone, cursor.x, cursor.y)?.i;
    if (target && isFrame(target)) {
      status = 'Un cadre reste droit, pour que la photo soit à l’endroit.';
      return render();
    }
    if (hand) {
      handRot = (handRot + 1) % 4;
      return render();
    }
    const p = occupant(cursor.zone, cursor.x, cursor.y);
    if (!p) return;
    const r = ((p.r ?? 0) + 1) % 4;
    const others = layout()[cursor.zone].filter((q) => q !== p);
    if (!fitsIn(others, room, cursor.zone, p.i, r, p.x, p.y)) {
      status = 'Pas la place de le tourner ici.';
      return render();
    }
    setLayout({ ...layout(), [cursor.zone]: [...others, { ...p, r }] });
  };

  const setPhoto = (p: Placed, art: number | undefined) => {
    pickingPhoto = null;
    const set = (l: Placed[]) => l.map((q) => (q.o === p.o ? { ...q, art } : q));
    setLayout({ floor: set(layout().floor), wall: set(layout().wall) });
  };

  /** Va dans une autre pièce ; le meuble en main suit (on peut ainsi le déménager). */
  const selectRoom = (id: string) => {
    if (id === room || (!mine() && !unlocked(id))) return;
    room = id;
    geom = geometry(roomOf(id));
    pickingPhoto = null;
    if (!unlocked()) {
      editing = false;
      hand = null;
      handArt = undefined;
    }
    cursor = { zone: 'floor', x: 0, y: 0 };
    sceneKey = '';
    resetView();
    render();
  };

  // Compteur de revenus : chaque seconde, seuls les textes changent.
  const rateEl = h('b', {});
  const perHourEl = h('span', { class: 'muted small' });
  const pendingLabel = h('span', { class: 'muted small' });
  const collectBtn = h('button', { class: 'field rl-spin', type: 'button' });
  collectBtn.addEventListener('mousedown', (e) => e.preventDefault());
  collectBtn.addEventListener('click', () => void doCollect());
  const renderIncome = () => {
    const p = pending(state);
    const cap = capHours(state.specials);
    const full = p >= Math.max(state.rate, 1) * cap - 0.5;
    rateEl.textContent = `${(state.rate / 3600).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} pt/s`;
    perHourEl.textContent = ` · ${formatPoints(Math.round(state.rate))} par heure`;
    pendingLabel.textContent = full ? `Coffre plein (${cap} h) : récolte !` : 'Versé tout seul toutes les 5 minutes, où que tu sois sur le site';
    collectBtn.textContent = `Récolter ${formatPoints(Math.floor(p))} maintenant (C)`;
    collectBtn.disabled = p < 1 || busy;
    if (!income.firstChild) income.append(h('div', {}, rateEl, perHourEl), mine() ? h('div', { class: 'ap-pending' }, pendingLabel, collectBtn) : '', breakdown);
  };

  // Gains par pièce : ce que rapportent les meubles de chaque pièce, bonus des équipements compris.
  const breakdown = h('details', { class: 'ap-breakdown' }, h('summary', {}, 'Gains par pièce'));
  const breakdownBody = h('div', {});
  breakdown.append(breakdownBody);
  const bar = (pct: number) => {
    const b = h('span', {});
    b.style.width = `${pct.toFixed(1)}%`; // propriété CSSOM : autorisée par la CSP, contrairement à un attribut style
    return b;
  };
  const renderBreakdown = () => {
    const mult = incomeMult(state.specials);
    const lines = state.rooms.map((id) => {
      const l = state.layout[id] ?? { floor: [], wall: [] };
      const items = [...l.floor, ...l.wall];
      return { label: `${roomOf(id).glyph} ${roomOf(id).name}`, n: items.length, perHour: items.reduce((t, p) => t + itemIncome(p.i), 0) * mult };
    });
    if (state.cleanStep) lines.push({ label: '🧹 Ménage', n: -1, perHour: state.cleanStep * CLEAN_RATE * mult });
    const total = lines.reduce((t, l) => t + l.perHour, 0) || 1;
    const best = Math.max(...lines.map((l) => l.perHour), 1);
    breakdownBody.replaceChildren(
      h(
        'table',
        { class: 'ap-gains' },
        ...lines
          .sort((a, b) => b.perHour - a.perHour)
          .map((l) =>
            h(
              'tr',
              {},
              h('td', {}, l.label, l.n >= 0 ? h('span', { class: 'muted small' }, ` · ${l.n} meuble${l.n > 1 ? 's' : ''}`) : ''),
              h('td', { class: 'ap-gains-bar' }, bar((100 * l.perHour) / best)),
              h('td', { class: 'num' }, `${formatPoints(Math.round(l.perHour))}/h`),
              h('td', { class: 'num muted small' }, `${Math.round((100 * l.perHour) / total)} %`),
            ),
          ),
      ),
      mult > 1 ? h('p', { class: 'muted small' }, `Bonus des équipements compris : × ${mult.toLocaleString('fr-FR')}`) : '',
    );
  };

  /** Appel au serveur qui dépense ou rapporte des points, puis rechargement. */
  const act = async (f: () => Promise<string>) => {
    if (busy) return;
    busy = true;
    try {
      status = await f();
      await reloadState();
      void refreshWallet();
    } catch (e) {
      status = (e as Error).message;
    } finally {
      busy = false;
      render();
    }
  };

  const doCollect = () =>
    mine() &&
    act(async () => {
      const r = await collectIncome();
      if (r.gain) blip(880);
      return r.gain ? `+${formatPoints(r.gain)} points récoltés.` : 'Rien à récolter pour l’instant.';
    });

  const doClean = () =>
    act(async () => {
      const task = CLEAN_TASKS[state.cleanStep];
      await cleanApartment();
      blip(700);
      return `${task.name} : fait !`;
    });

  const doBuyRoom = (id: string) =>
    act(async () => {
      await buyRoom(id);
      blip(990);
      return `${roomOf(id).name} débloquée !`;
    });

  const doBuySpecial = () => {
    const sp = specialOf(room);
    if (!sp || !mine() || state.specials.includes(sp.id)) return;
    return act(async () => {
      await buySpecial(sp.id);
      blip(1180);
      return `${sp.name} installé : ${sp.effect.toLowerCase()} !`;
    });
  };

  const toggleEdit = () => {
    if (!mine() || state.cleanStep < CLEAN_TASKS.length || !unlocked()) return;
    editing = !editing;
    hand = null;
    handArt = undefined;
    pickingPhoto = null;
    render();
  };

  /** Pourquoi la pièce `id` ne peut pas encore s'acheter (pièce de luxe : il faut d'abord sa voisine). */
  const roomBlocked = (id: string) => {
    const req = roomOf(id).requires;
    return req && !unlocked(req) ? `Débloque d’abord : ${roomOf(req).name}.` : '';
  };

  const renderTabs = () => {
    const list = mine() ? ROOMS : ROOMS.filter((r) => unlocked(r.id));
    tabs.hidden = list.length < 2;
    tabs.replaceChildren(
      ...list.map((r) => {
        const i = ROOMS.indexOf(r);
        const open = unlocked(r.id);
        const b = h(
          'button',
          { class: `ap-room${r.id === room ? ' on' : ''}${open ? '' : ' locked'}`, type: 'button', role: 'tab', 'aria-selected': String(r.id === room), title: `${r.name} (${i + 1})` },
          h('span', { 'aria-hidden': 'true' }, open ? r.glyph : '🔒'),
          ` ${r.name}`,
        );
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => selectRoom(r.id));
        return b;
      }),
    );
  };

  /** Carte de l'équipement spécial de la pièce : son effet, et le bouton pour l'installer. */
  const specialCard = () => {
    const sp = specialOf(room);
    if (!sp) return '';
    const has = state.specials.includes(sp.id);
    const b = has ? null : h('button', { class: 'field rl-spin', type: 'button', disabled: busy }, `Installer · ◆ ${formatPoints(sp.cost)}`);
    b?.addEventListener('click', () => void doBuySpecial());
    return h(
      'div',
      { class: `ap-special${has ? ' on' : ''}` },
      h('h3', {}, `${sp.glyph} ${sp.name}`),
      h('p', { class: 'small' }, has ? `✓ Installé : ${sp.effect.toLowerCase()}.` : sp.effect),
      b ?? '',
    );
  };

  const renderSide = () => {
    if (!mine()) {
      side.hidden = true;
      return;
    }
    side.hidden = false;
    // Pièce pas encore achetée : on la voit vide, avec son prix.
    if (!unlocked()) {
      const r = roomOf(room);
      const cost = roomCost(r.id, state.rooms);
      const ready = state.cleanStep >= CLEAN_TASKS.length;
      const blocked = roomBlocked(r.id);
      const sp = specialOf(r.id);
      const b = h('button', { class: 'field rl-spin', type: 'button', disabled: busy || !ready || !!blocked || cost === undefined }, `Débloquer · ◆ ${formatPoints(cost ?? 0)}`);
      b.addEventListener('click', () => void doBuyRoom(r.id));
      side.replaceChildren(
        h('h2', {}, `${r.glyph} ${r.name}`),
        h(
          'p',
          { class: 'muted small' },
          !ready
            ? 'Nettoie d’abord ton entrée.'
            : r.price
              ? `Pièce de luxe, à prix fixe.${blocked ? ` ${blocked}` : ''}`
              : `Chaque pièce achetée rend la suivante plus chère (${ROOM_COSTS.map((c) => formatPoints(c)).join(' → ')}).`,
        ),
        sp ? h('p', { class: 'ap-special-info small' }, `${sp.glyph} À installer ensuite : ${sp.name} (◆ ${formatPoints(sp.cost)}), ${sp.effect.toLowerCase()}.`) : '',
        b,
      );
      return;
    }
    // Il faut d'abord nettoyer.
    if (state.cleanStep < CLEAN_TASKS.length) {
      const task = CLEAN_TASKS[state.cleanStep];
      const b = h('button', { class: 'field rl-spin', type: 'button', disabled: busy }, `${task.name} · ◆ ${formatPoints(task.cost)}`);
      b.addEventListener('click', () => void doClean());
      side.replaceChildren(
        h('h2', {}, 'Ton entrée est en désordre'),
        h('p', { class: 'muted small' }, 'Nettoie-la pour pouvoir meubler.'),
        h('ol', { class: 'ap-tasks' }, ...CLEAN_TASKS.map((t, i) => h('li', { class: i < state.cleanStep ? 'done' : i === state.cleanStep ? 'next' : '' }, t.name, h('span', { class: 'muted small' }, ` ◆ ${formatPoints(t.cost)}`)))),
        b,
      );
      return;
    }
    const used = new Set(placedAll().map((p) => p.o));
    if (!editing) {
      const edit = h('button', { class: 'field rl-spin', type: 'button' }, 'Aménager (E)');
      edit.addEventListener('click', toggleEdit);
      const here = layout().floor.length + layout().wall.length;
      side.replaceChildren(
        h('h2', {}, `${roomOf(room).glyph} ${roomOf(room).name}`),
        h('p', { class: 'muted small' }, `${here} meuble${here > 1 ? 's' : ''} ici · ${owned.length - used.size} en réserve`),
        edit,
        specialCard(),
      );
      return;
    }
    const free = owned.filter((o) => !used.has(o.id) && o.id !== hand?.id);
    const list = free.length
      ? free.map((o) => {
          const b = h(
            'button',
            { class: `ap-inv rar-${finishOf(o.item_id).rarity}`, type: 'button' },
            furnitureEl(o.item_id),
            h('span', {}, itemName(o.item_id), h('span', { class: 'muted small' }, ` · ${formatPoints(Math.round(itemIncome(o.item_id)))}/h`)),
          );
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', () => {
            hand = o;
            sellArmed = false;
            handArt = undefined;
            handRot = 0;
            const zone = sizeOf(o.item_id).place;
            if (zone !== cursor.zone) cursor = { zone, x: 0, y: 0 };
            render();
          });
          return b;
        })
      : [h('p', { class: 'muted small' }, 'Réserve vide.')];
    const done = h('button', { class: 'field', type: 'button' }, 'Terminer (E)');
    done.addEventListener('click', toggleEdit);
    const turn = h('button', { class: 'field', type: 'button' }, hand ? `Pivoter (R) · ${handRot * 90}°` : 'Pivoter (R)');
    const stash = hand ? h('button', { class: 'field rl-spin', type: 'button' }, 'Ranger dans la réserve (Suppr)') : null;
    stash?.addEventListener('mousedown', (e) => e.preventDefault());
    stash?.addEventListener('click', () => {
      hand = null;
      handArt = undefined;
      sellArmed = false;
      render();
    });
    const sell = hand
      ? h('button', { class: 'field', type: 'button', disabled: busy }, sellArmed ? `Confirmer : vendre ◆ ${formatPoints(sellPrice(hand.item_id))} (V)` : `Vendre ◆ ${formatPoints(sellPrice(hand.item_id))} (V)`)
      : null;
    sell?.addEventListener('mousedown', (e) => e.preventDefault());
    sell?.addEventListener('click', () => void sellHand());
    turn.addEventListener('mousedown', (e) => e.preventDefault());
    turn.addEventListener('click', rotate);
    side.replaceChildren(
      h('h2', {}, hand ? `En main : ${itemName(hand.item_id)}` : 'Mes meubles'),
      h('p', { class: 'muted small' }, hand ? 'Clique une case libre pour le poser.' : 'Clique un meuble posé pour le prendre.'),
      pickingPhoto
        ? h(
            'div',
            { class: 'ap-photos' },
            h('h3', {}, isFrame(pickingPhoto.i) ? 'Photo du cadre' : 'Photo du papier peint'),
            pickable().length ? '' : h('p', { class: 'muted small' }, 'Aucune photo : caisse souvenirs.'),
            ...pickable().map((a) => {
              const b = h('button', { class: 'ap-photo', type: 'button', title: a.title }, h('img', { src: a.url, alt: a.title, loading: 'lazy' }));
              b.addEventListener('click', () => setPhoto(pickingPhoto!, a.id));
              return b;
            }),
          )
        : '',
      hand ? h('div', { class: 'ap-hand-actions' }, stash!, sell!, turn) : turn,
      h('div', { class: 'ap-inventory' }, ...list),
      done,
    );
  };

  let overlay: Overlay | null = null;
  let sceneKey = '';
  const drawOverlay = () =>
    overlay?.draw(editing ? cursor : null, editing && hand ? { item: hand.item_id, r: handRot, ok: fits(hand.item_id, cursor.zone, cursor.x, cursor.y) } : null);

  const render = () => {
    // La pièce (des centaines de formes) n'est redessinée que si son contenu a changé.
    const key = JSON.stringify([room, state.rooms, state.specials, layout(), state.cleanStep, editing, photos.length]);
    if (key !== sceneKey || !overlay) {
      sceneKey = key;
      svg.setAttribute('class', `iso-room room-${room}${unlocked() ? '' : ' locked'}${view.z > 1 ? ' zoomed' : ''}`);
      overlay = drawScene(svg, geom, {
        layout: layout(),
        clean: room === 'entree' ? state.cleanStep : CLEAN_TASKS.length,
        photos,
        editing,
        isOpen: (id) => unlocked(id),
        fixture: (() => {
          const sp = specialOf(room);
          return sp && unlocked() ? { ...sp, owned: state.specials.includes(sp.id) } : null;
        })(),
        onFixture: () => {
          const sp = specialOf(room)!;
          const has = state.specials.includes(sp.id);
          status = `${sp.name} : ${sp.effect.toLowerCase()}.${!has && mine() ? ` À installer pour ◆ ${formatPoints(sp.cost)}.` : ''}`;
          statusEl.textContent = status;
        },
        onDoor: (id) => {
          // Chez soi, une porte fermée mène quand même à la pièce : on y voit son prix.
          if (unlocked(id) || mine()) return selectRoom(id);
          status = `${roomOf(id).name} : porte fermée.`;
          statusEl.textContent = status;
        },
        onCell: activate,
        onHover: (zone, x, y) => {
          if (!editing || (cursor.zone === zone && cursor.x === x && cursor.y === y)) return;
          cursor = { zone, x, y };
          drawOverlay();
        },
      });
    }
    drawOverlay();
    svg.classList.toggle('editing', editing);
    statusEl.textContent = status;
    renderIncome();
    renderBreakdown();
    renderTabs();
    renderSide();
  };

  const renderHeader = () => {
    // Plus de lien à partager : on visite l'appart de ses amis depuis la page Amis.
    const friendsBtn = h('button', { class: 'field', type: 'button' }, 'Mes amis');
    friendsBtn.addEventListener('click', () => navigate('/amis'));
    const crates = h('button', { class: 'field', type: 'button' }, 'Meubles et caisses');
    crates.addEventListener('click', () => navigate('/caisses'));
    header.replaceChildren(
      h('h1', {}, mine() ? 'Mon appart' : h('span', {}, 'Appart de ', nameEl(owner, ownerName))),
      h('div', { class: 'ap-actions' }, friendsBtn, mine() ? crates : ''),
    );
  };

  (async () => {
    const account = await ensureAccount();
    if (!account) throw new Error('Connexion au serveur impossible.');
    me = account.id;
    // Le routeur transmet « undefined » quand l'identifiant est absent (#/appart).
    owner = /^[0-9a-f-]{36}$/.test(ownerParam ?? '') ? ownerParam : me;
    const supabase = await getSupabase();
    // L'appart d'un autre n'est visible que par ses amis (et les admins) : le serveur ne renverrait rien.
    if (owner !== me) {
      const [friend, isAdm] = await Promise.all([supabase!.rpc('are_friends', { x: me, y: owner }), isAdmin()]);
      if (disposed) return;
      if (!friend.data && !isAdm) {
        const go = h('button', { class: 'field', type: 'button' }, 'Mes amis');
        go.addEventListener('click', () => navigate('/amis'));
        wrap.replaceChildren(h('div', { class: 'card narrow' }, h('h1', {}, 'Appart privé'), h('p', { class: 'muted' }, 'Seuls ses amis peuvent visiter cet appart.'), go));
        return;
      }
    }
    const [a, p, prof] = await Promise.all([loadApartment(owner), artworks(), supabase!.from('profiles').select('username').eq('id', owner).maybeSingle()]);
    if (disposed) return;
    state = a;
    photos = p;
    ownerName = (prof.data?.username as string | undefined) ?? 'Inconnu';
    if (mine()) {
      [owned, unlockedPhotos, admin] = await Promise.all([myFurniture(me), ownedPhotos(me), isAdmin()]);
    }
    if (disposed) return;
    wrap.replaceChildren(header, income, tabs, h('div', { class: 'ap-main' }, h('div', { class: 'ap-stage' }, svg, zoomBar), side), statusEl);
    resetView();
    renderHeader();
    render();
    // Le compteur de revenus avance chaque seconde.
    const tick = window.setInterval(renderIncome, 1000);
    offs.push(() => clearInterval(tick));
    // Récolte automatique (toutes les pages) : le compteur repart de ce qui reste.
    if (mine()) offs.push(onIdleIncome(() => void reloadState().then(render)));
    // Visite : l'appart se met à jour en direct quand son propriétaire le modifie.
    if (!mine() && supabase) {
      const ch = supabase
        .channel(`appart:${owner}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'apartments', filter: `user_id=eq.${owner}` }, () => void reloadState().then(render))
        .subscribe();
      offs.push(() => void supabase.removeChannel(ch));
    }
  })().catch((e: Error) => !disposed && wrap.replaceChildren(h('p', { class: 'notice' }, e.message)));

  const move = (dx: number, dy: number) => {
    const { w: W, d: D } = roomOf(room);
    let { zone, x, y } = cursor;
    x += dx;
    y += dy;
    if (zone === 'floor') {
      // Au fond de la pièce, on monte sur le mur correspondant.
      if (y < 0) ((zone = 'wall'), (x = D + Math.max(0, Math.min(W - 1, x))), (y = WALL_ROWS - 1));
      else if (x < 0) ((zone = 'wall'), (x = Math.max(0, Math.min(D - 1, y))), (y = WALL_ROWS - 1));
    } else if (y >= WALL_ROWS) {
      // Depuis le bas d'un mur, on redescend sur le sol.
      if (x >= D) ((zone = 'floor'), (x = x - D), (y = 0));
      else ((zone = 'floor'), (y = x), (x = 0));
    }
    const d = zoneDims(room, zone);
    cursor = { zone, x: Math.max(0, Math.min(d.cols - 1, x)), y: Math.max(0, Math.min(d.rows - 1, y)) };
    render();
  };

  offs.push(
    pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (lightbox && (key === 'escape' || key === 'backspace' || key === 'enter' || key === ' ')) {
        e.preventDefault();
        return closePhoto();
      }
      if (key === 'backspace') {
        e.preventDefault();
        if (hand) {
          hand = null;
          handArt = undefined;
          return render();
        }
        return navigate('/');
      }
      if (key === 'e') return toggleEdit();
      if (key === 'c') return void doCollect();
      if (key === '+' || key === '=') return zoomTo(view.z * 1.25);
      if (key === '-') return zoomTo(view.z / 1.25);
      if (key === '0') return resetView();
      if (/^[1-9]$/.test(key) && ROOMS[Number(key) - 1]) return selectRoom(ROOMS[Number(key) - 1].id);
      if (!editing) return;
      if (key === 'arrowleft') move(-1, 0);
      else if (key === 'arrowright') move(1, 0);
      else if (key === 'arrowup') move(0, -1);
      else if (key === 'arrowdown') move(0, 1);
      else if (key === 'enter' || key === ' ') activate(cursor.zone, cursor.x, cursor.y);
      else if (key === 'delete' || key === 'x') {
        if (hand) {
          hand = null;
          handArt = undefined;
          render();
        } else {
          const p = occupant(cursor.zone, cursor.x, cursor.y);
          if (p) setLayout({ ...layout(), [cursor.zone]: layout()[cursor.zone].filter((q) => q !== p) });
        }
      } else if (key === 'r') rotate();
      else if (key === 'v') void sellHand();
      else if (key === 'p') {
        const p = occupant(cursor.zone, cursor.x, cursor.y);
        if (p && takesPhoto(p.i)) {
          pickingPhoto = p;
          render();
        }
      } else if (key === 'tab') {
        const used = new Set(placedAll().map((p) => p.o));
        const free = owned.filter((o) => !used.has(o.id));
        if (!free.length) return;
        const i = hand ? free.findIndex((o) => o.id === hand!.id) : -1;
        hand = free[(i + 1) % free.length];
        handArt = undefined;
        handRot = 0;
        const zone = sizeOf(hand.item_id).place;
        if (zone !== cursor.zone) cursor = { zone, x: 0, y: 0 };
        render();
      } else return;
      e.preventDefault();
    }),
  );
  content.append(
    hints(
      ['E', 'aménager'],
      ['C', 'récolter'],
      ['1 – 9', 'pièce'],
      ['+ − 0', 'zoom'],
      ['← ↑ → ↓', 'case'],
      ['Tab', 'meuble suivant'],
      ['Entrée', 'poser / reprendre'],
      ['R', 'pivoter'],
      ['Suppr', 'ranger'],
      ['P', 'photo (cadre, meuble personnalisable)'],
      ['Retour arrière', 'quitter'],
    ),
  );

  return () => {
    disposed = true;
    clearTimeout(saveTimer);
    if (unsaved) void saveLayout(state.layout).catch(() => {}); // on quitte la page juste après un changement
    offs.forEach((off) => off());
  };
}
