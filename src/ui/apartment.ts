import { isTyping, pushKeys } from '../core/input';
import { blip } from '../core/sound';
import { isAdmin } from '../net/admin';
import {
  artworks,
  baseOf,
  CAP_HOURS,
  CLEAN_RATE,
  CLEAN_TASKS,
  cleanApartment,
  collectIncome,
  finishOf,
  itemIncome,
  itemName,
  loadApartment,
  myFurniture,
  N,
  pending,
  saveLayout,
  WALL_COLS,
  WALL_ROWS,
  type ApartmentState,
  type Artwork,
  type Layout,
  type Owned,
  type Placed,
} from '../net/apartment';
import { ensureAccount } from '../net/auth';
import { nameEl } from '../net/cosmetics';
import { formatPoints, refreshWallet } from '../net/points';
import { getSupabase } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

type Zone = 'wall' | 'floor';
const DIMS: Record<Zone, { cols: number; rows: number }> = { floor: { cols: N, rows: N }, wall: { cols: WALL_COLS, rows: WALL_ROWS } };

/** Un meuble en HTML (inventaire, caisses) : glyphe et finition (classe fin-*), ou photo pour un cadre. */
export function furnitureEl(item: string, art?: Artwork): HTMLElement {
  const base = baseOf(item);
  const fin = finishOf(item);
  if (base?.id === 'frame') {
    return h(
      'span',
      { class: `ap-frame fin-${fin.id}`, title: art?.title ?? itemName(item) },
      art ? h('img', { src: art.url, alt: art.title, loading: 'lazy', draggable: 'false' }) : h('span', { class: 'ap-frame-empty' }, '🖼️'),
    );
  }
  return h('span', { class: `ap-glyph fin-${fin.id}`, title: itemName(item) }, base?.glyph ?? '?');
}

// ---------------------------------------------------------------------------
// Vue isométrique (SVG) : sol en losanges, deux murs du fond, meubles triés par profondeur.
// ---------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
const TW = 96; // largeur d'une case du sol à l'écran
const TH = 48; // hauteur d'une case (rapport 2:1)
const WH = 190; // hauteur des murs
const PAD = 24;
const OX = N * (TW / 2) + PAD; // coin du fond de la pièce
const OY = WH + PAD;
const VIEW_W = N * TW + 2 * PAD;
const VIEW_H = OY + N * TH + PAD + 20;
const SKEW = (Math.atan(0.5) * 180) / Math.PI; // 26,57° : pente des murs

/** Point du sol aux coordonnées de grille (x, y), éventuellement surélevé de `z`. */
const P = (x: number, y: number, z = 0) => [OX + ((x - y) * TW) / 2, OY + ((x + y) * TH) / 2 - z] as const;
const pts = (...p: (readonly [number, number])[]) => p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) e.append(c);
  return e;
}

/** Emplacement de mur : x < N = mur de gauche (le long de y), sinon mur de droite (le long de x). */
function wallSlot(x: number, row: number) {
  const left = x < N;
  const i = left ? x : x - N;
  const a = left ? P(0, i) : P(i, 0);
  const b = left ? P(0, i + 1) : P(i + 1, 0);
  const [lo, hi] = row === 0 ? [WH * 0.52, WH * 0.94] : [WH * 0.1, WH * 0.5];
  const poly = pts([a[0], a[1] - lo], [b[0], b[1] - lo], [b[0], b[1] - hi], [a[0], a[1] - hi]);
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2 - (lo + hi) / 2;
  return { poly, cx, cy, skew: left ? -SKEW : SKEW };
}

// Désordre du début : chaque tâche de nettoyage en retire une partie.
const BOXES: [number, number][] = [[1, 2], [2, 2], [5, 1], [6, 5], [3, 6], [1, 5]];
const TRASH: [number, number][] = [[6, 2], [2, 6], [4, 4]];
const WEBS: [number, number][] = [[0, 0], [7, 0], [8, 0], [15, 0], [11, 1]];
const DUST: [number, number][] = [[2, 1], [4, 2], [6, 3], [1, 4], [3, 5], [5, 6], [6, 7], [0, 6]];
const BROKEN: [number, number][] = [[3, 1], [5, 3], [2, 4], [6, 6], [4, 7], [0, 2]];
const STAINS: [number, number][] = [[2, 1], [5, 0], [10, 1], [13, 0], [9, 0]];

interface Scene {
  layout: Layout;
  cleanStep: number;
  photos: Artwork[];
  editing: boolean;
  cursor: { zone: Zone; x: number; y: number } | null;
  ghost: { item: string; ok: boolean } | null;
  onCell(zone: Zone, x: number, y: number): void;
  onHover(zone: Zone, x: number, y: number): void;
}

function drawScene(svg: SVGSVGElement, s: Scene): void {
  const clean = s.cleanStep;
  const parts: SVGElement[] = [];
  const dirtyWalls = clean < 6;
  const isCursor = (zone: Zone, x: number, y: number) => s.cursor?.zone === zone && s.cursor.x === x && s.cursor.y === y;

  // Murs (le gauche plus clair, le droit plus sombre : la lumière vient de la gauche), joints et plinthe
  const top = P(0, 0, WH);
  parts.push(el('polygon', { points: pts(P(0, 0), P(0, N), P(0, N, WH), top), class: 'iso-wall left' + (dirtyWalls ? ' dirty' : '') }));
  parts.push(el('polygon', { points: pts(P(0, 0), P(N, 0), P(N, 0, WH), top), class: 'iso-wall right' + (dirtyWalls ? ' dirty' : '') }));
  for (let i = 1; i < N; i++) {
    parts.push(el('line', { x1: P(0, i)[0], y1: P(0, i)[1], x2: P(0, i, WH)[0], y2: P(0, i, WH)[1], class: 'iso-wall-seam' }));
    parts.push(el('line', { x1: P(i, 0)[0], y1: P(i, 0)[1], x2: P(i, 0, WH)[0], y2: P(i, 0, WH)[1], class: 'iso-wall-seam' }));
  }
  if (dirtyWalls) {
    for (const [x, row] of STAINS) {
      const w = wallSlot(x, row);
      parts.push(el('ellipse', { cx: w.cx, cy: w.cy, rx: 26, ry: 18, class: 'iso-stain', transform: `rotate(${w.skew} ${w.cx} ${w.cy})` }));
    }
  }
  parts.push(el('polyline', { points: pts(P(0, N, 8), P(0, 0, 8), P(N, 0, 8)), class: 'iso-baseboard' }));

  // Sol
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const broken = clean < 5 && BROKEN.some(([a, b]) => a === x && b === y);
      const tile = el('polygon', {
        points: pts(P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)),
        class: `iso-tile ${(x + y) % 2 ? 'b' : 'a'}${broken ? ' broken' : ''}${s.editing ? ' edit' : ''}${isCursor('floor', x, y) ? ' cursor' : ''}`,
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
    for (let x = 0; x < WALL_COLS; x++) {
      const w = wallSlot(x, row);
      const slot = el('polygon', { points: w.poly, class: `iso-slot${s.editing ? ' edit' : ''}${isCursor('wall', x, row) ? ' cursor' : ''}` });
      slot.addEventListener('click', () => s.onCell('wall', x, row));
      slot.addEventListener('mouseenter', () => s.onHover('wall', x, row));
      parts.push(slot);
    }
  const wallItem = (p: { i: string; x: number; y: number; art?: number }, ghost = false) => {
    const w = wallSlot(p.x, p.y);
    const g = el('g', { transform: `translate(${w.cx.toFixed(1)} ${w.cy.toFixed(1)}) skewY(${w.skew})`, class: `iso-item${ghost ? ' ghost' : ''}` });
    const fin = finishOf(p.i).id;
    if (baseOf(p.i)?.id === 'frame') {
      const art = s.photos.find((a) => a.id === p.art);
      const frame = el('g', { class: `iso-frame fin-${fin}` });
      frame.append(el('rect', { x: -30, y: -24, width: 60, height: 48, class: 'iso-frame-border' }));
      if (art) frame.append(el('image', { href: art.url, x: -25, y: -19, width: 50, height: 38, preserveAspectRatio: 'xMidYMid slice' }));
      else frame.append(el('rect', { x: -25, y: -19, width: 50, height: 38, class: 'iso-frame-empty' }));
      g.append(frame);
    } else {
      g.append(el('text', { class: `iso-glyph fin-${fin}`, 'font-size': 52, y: 18 }, p.i === 'web' ? '🕸️' : (baseOf(p.i)?.glyph ?? '?')));
    }
    return g;
  };
  for (const p of s.layout.wall) parts.push(wallItem(p));
  if (clean < 3) for (const [x, row] of WEBS) parts.push(wallItem({ i: 'web', x, y: row }));

  // Objets du sol, du fond vers l'avant (le plus proche est dessiné en dernier)
  const sprites: { depth: number; node: SVGElement }[] = [];
  const floorItem = (item: string, x: number, y: number, ghost = false, glyph?: string) => {
    const b = baseOf(item);
    const w = b?.w ?? 1;
    const hgt = b?.h ?? 1;
    const [cx, cy] = P(x + w / 2, y + hgt / 2);
    const size = TW * 0.78 * Math.sqrt(w * hgt) ** 0.85;
    const g = el('g', { class: `iso-item${ghost ? ' ghost' : ''}` });
    g.append(el('ellipse', { cx, cy, rx: (TW / 2.6) * ((w + hgt) / 2), ry: (TH / 2.6) * ((w + hgt) / 2), class: 'iso-shadow' }));
    g.append(el('text', { x: cx, y: cy + size * 0.18, class: `iso-glyph fin-${finishOf(item).id}`, 'font-size': size.toFixed(1) }, glyph ?? b?.glyph ?? '?'));
    sprites.push({ depth: x + w + y + hgt + (ghost ? 0.01 : 0), node: g });
    return g;
  };
  for (const p of s.layout.floor) floorItem(p.i, p.x, p.y);
  if (clean < 1) for (const [x, y] of BOXES) floorItem('mess', x, y, false, '📦');
  if (clean < 2) for (const [x, y] of TRASH) floorItem('mess', x, y, false, '🗑️');
  if (s.ghost && s.cursor?.zone === 'floor') floorItem(s.ghost.item, s.cursor.x, s.cursor.y, true).classList.toggle('bad', !s.ghost.ok);
  sprites.sort((a, b) => a.depth - b.depth).forEach((sp) => parts.push(sp.node));
  if (s.ghost && s.cursor?.zone === 'wall') {
    const g = wallItem({ i: s.ghost.item, x: s.cursor.x, y: s.cursor.y }, true);
    g.classList.toggle('bad', !s.ghost.ok);
    parts.push(g);
  }
  svg.replaceChildren(...parts);
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
  let state: ApartmentState = { layout: { floor: [], wall: [] }, cleanStep: 0, rate: 0, banked: 0, lastTick: Date.now() };
  let owned: Owned[] = [];
  let photos: Artwork[] = [];
  let editing = false;
  let hand: Owned | null = null;
  let cursor: { zone: Zone; x: number; y: number } = { zone: 'floor', x: 3, y: 3 };
  let status = '';
  let saveTimer: number | undefined;
  let unsaved = false;
  let pickingPhoto: Placed | null = null;
  let busy = false;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute('class', 'iso-room');
  const side = h('aside', { class: 'ap-side card' });
  const statusEl = h('p', { class: 'status' });
  const header = h('div', { class: 'ap-head' });
  const income = h('div', { class: 'ap-income' });

  const mine = () => owner === me;
  const layout = () => state.layout;
  const sizeOf = (item: string) => {
    const b = baseOf(item);
    return { w: b?.w ?? 1, h: b?.h ?? 1, place: (b?.place ?? 'floor') as Zone };
  };
  const occupant = (zone: Zone, x: number, y: number) =>
    layout()[zone].find((p) => {
      const s = sizeOf(p.i);
      return x >= p.x && x < p.x + s.w && y >= p.y && y < p.y + s.h;
    });
  const fits = (item: string, zone: Zone, x: number, y: number) => {
    const s = sizeOf(item);
    if (s.place !== zone || x + s.w > DIMS[zone].cols || y + s.h > DIMS[zone].rows) return false;
    for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) if (occupant(zone, x + dx, y + dy)) return false;
    return true;
  };

  const reloadState = async () => {
    const fresh = await loadApartment(owner);
    // Garde l'aménagement affiché s'il reste des changements à envoyer.
    state = unsaved ? { ...fresh, layout: state.layout } : fresh;
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

  const setLayout = (l: Layout) => {
    state = { ...state, layout: l };
    scheduleSave();
    render();
  };

  const activate = (zone: Zone, x: number, y: number) => {
    if (!editing) return;
    cursor = { zone, x, y };
    if (hand) {
      if (!fits(hand.item_id, zone, x, y)) return;
      const entry: Placed = { o: hand.id, i: hand.item_id, x, y };
      const isFrame = baseOf(hand.item_id)?.id === 'frame';
      hand = null;
      if (isFrame && photos.length) pickingPhoto = entry;
      setLayout({ ...layout(), [zone]: [...layout()[zone], entry] });
      return;
    }
    const p = occupant(zone, x, y);
    if (!p) return;
    hand = owned.find((o) => o.id === p.o) ?? null;
    setLayout({ ...layout(), [zone]: layout()[zone].filter((q) => q !== p) });
  };

  const setPhoto = (p: Placed, art: number | undefined) => {
    pickingPhoto = null;
    setLayout({ ...layout(), wall: layout().wall.map((q) => (q.o === p.o ? { ...q, art } : q)) });
  };

  const renderIncome = () => {
    const p = pending(state);
    const perSec = state.rate / 3600;
    const full = p >= Math.max(state.rate, 1) * CAP_HOURS - 0.5;
    const collect = h('button', { class: 'field rl-spin', type: 'button', disabled: p < 1 || busy }, `Récolter ${formatPoints(Math.floor(p))} (C)`);
    collect.addEventListener('mousedown', (e) => e.preventDefault());
    collect.addEventListener('click', () => void doCollect());
    income.replaceChildren(
      h('div', {}, h('b', {}, `${perSec.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} pt/s`), h('span', { class: 'muted small' }, ` · ${formatPoints(Math.round(state.rate))} par heure`)),
      mine() ? h('div', { class: 'ap-pending' }, h('span', { class: 'muted small' }, full ? `Coffre plein (${CAP_HOURS} h) : récolte !` : 'À récolter'), collect) : '',
    );
  };

  const doCollect = async () => {
    if (busy || !mine()) return;
    busy = true;
    try {
      const r = await collectIncome();
      status = r.gain ? `+${formatPoints(r.gain)} points récoltés.` : 'Rien à récolter pour l’instant.';
      if (r.gain) blip(880);
      await reloadState();
      void refreshWallet();
    } catch (e) {
      status = (e as Error).message;
    } finally {
      busy = false;
      render();
    }
  };

  const doClean = async () => {
    if (busy) return;
    busy = true;
    try {
      const task = CLEAN_TASKS[state.cleanStep];
      await cleanApartment();
      status = `${task.name} : fait !`;
      blip(700);
      await reloadState();
      void refreshWallet();
    } catch (e) {
      status = (e as Error).message;
    } finally {
      busy = false;
      render();
    }
  };

  const toggleEdit = () => {
    if (!mine() || state.cleanStep < CLEAN_TASKS.length) return;
    editing = !editing;
    hand = null;
    pickingPhoto = null;
    render();
  };

  const renderSide = () => {
    if (!mine()) {
      side.hidden = true;
      return;
    }
    side.hidden = false;
    // Il faut d'abord nettoyer.
    if (state.cleanStep < CLEAN_TASKS.length) {
      const task = CLEAN_TASKS[state.cleanStep];
      const b = h('button', { class: 'field rl-spin', type: 'button', disabled: busy }, `${task.name} · ◆ ${formatPoints(task.cost)}`);
      b.addEventListener('click', () => void doClean());
      side.replaceChildren(
        h('h2', {}, 'Ton appart est en désordre'),
        h('p', { class: 'muted small' }, `Il faut le nettoyer avant de pouvoir le meubler. Chaque étape rapporte aussi ${CLEAN_RATE} points par heure.`),
        h('ol', { class: 'ap-tasks' }, ...CLEAN_TASKS.map((t, i) => h('li', { class: i < state.cleanStep ? 'done' : i === state.cleanStep ? 'next' : '' }, t.name, h('span', { class: 'muted small' }, ` ◆ ${formatPoints(t.cost)}`)))),
        b,
      );
      return;
    }
    const used = new Set([...layout().floor, ...layout().wall].map((p) => p.o));
    if (!editing) {
      const edit = h('button', { class: 'field rl-spin', type: 'button' }, 'Aménager (E)');
      edit.addEventListener('click', toggleEdit);
      side.replaceChildren(
        h('h2', {}, 'Ton appart'),
        h('p', { class: 'muted small' }, `${used.size} meuble${used.size > 1 ? 's' : ''} posé${used.size > 1 ? 's' : ''}, ${owned.length - used.size} en réserve. Plus il y a de meubles, et plus ils sont rares, plus l’appart rapporte.`),
        edit,
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
            const zone = sizeOf(o.item_id).place;
            if (zone !== cursor.zone) cursor = { zone, x: 0, y: 0 };
            render();
          });
          return b;
        })
      : [h('p', { class: 'muted small' }, 'Tous tes meubles sont placés. Il y en a d’autres dans les caisses.')];
    const done = h('button', { class: 'field', type: 'button' }, 'Terminer (E)');
    done.addEventListener('click', toggleEdit);
    side.replaceChildren(
      h('h2', {}, hand ? `En main : ${itemName(hand.item_id)}` : 'Mes meubles'),
      h('p', { class: 'muted small' }, hand ? 'Clique une case libre (ou Entrée) pour le poser ; Suppr pour le ranger.' : 'Choisis un meuble, ou clique un meuble posé pour le déplacer.'),
      pickingPhoto
        ? h(
            'div',
            { class: 'ap-photos' },
            h('h3', {}, 'Photo du cadre'),
            ...photos.map((a) => {
              const b = h('button', { class: 'ap-photo', type: 'button', title: a.title }, h('img', { src: a.url, alt: a.title, loading: 'lazy' }));
              b.addEventListener('click', () => setPhoto(pickingPhoto!, a.id));
              return b;
            }),
          )
        : '',
      h('div', { class: 'ap-inventory' }, ...list),
      done,
    );
  };

  const render = () => {
    drawScene(svg, {
      layout: layout(),
      cleanStep: state.cleanStep,
      photos,
      editing,
      cursor: editing ? cursor : null,
      ghost: editing && hand ? { item: hand.item_id, ok: fits(hand.item_id, cursor.zone, cursor.x, cursor.y) } : null,
      onCell: activate,
      onHover: (zone, x, y) => {
        if (!editing || (cursor.zone === zone && cursor.x === x && cursor.y === y)) return;
        cursor = { zone, x, y };
        render();
      },
    });
    svg.classList.toggle('editing', editing);
    statusEl.textContent = status;
    renderIncome();
    renderSide();
  };

  const renderHeader = () => {
    const link = `${location.origin}${location.pathname}#/appart/${owner}`;
    const copy = h('button', { class: 'field', type: 'button' }, 'Copier le lien');
    copy.addEventListener('click', () =>
      navigator.clipboard?.writeText(link).then(
        () => ((status = 'Lien copié.'), render()),
        () => ((status = link), render()),
      ),
    );
    const crates = h('button', { class: 'field', type: 'button' }, 'Meubles et caisses');
    crates.addEventListener('click', () => navigate('/caisses'));
    header.replaceChildren(
      h('h1', {}, mine() ? 'Mon appart' : h('span', {}, 'Appart de ', nameEl(owner, ownerName))),
      h('div', { class: 'ap-actions' }, copy, mine() ? crates : ''),
    );
  };

  (async () => {
    const account = await ensureAccount();
    if (!account) throw new Error('Connexion au serveur impossible.');
    if (!(await isAdmin())) {
      wrap.replaceChildren(h('div', { class: 'card narrow' }, h('h1', {}, 'Bientôt'), h('p', { class: 'muted' }, 'Les apparts ne sont pas encore ouverts.')));
      return;
    }
    me = account.id;
    // Le routeur transmet « undefined » quand l'identifiant est absent (#/appart).
    owner = /^[0-9a-f-]{36}$/.test(ownerParam ?? '') ? ownerParam : me;
    const supabase = await getSupabase();
    const [a, p, prof] = await Promise.all([loadApartment(owner), artworks(), supabase!.from('profiles').select('username').eq('id', owner).maybeSingle()]);
    if (disposed) return;
    state = a;
    photos = p;
    ownerName = (prof.data?.username as string | undefined) ?? 'Inconnu';
    if (mine()) owned = await myFurniture(me);
    if (disposed) return;
    wrap.replaceChildren(header, income, h('div', { class: 'ap-main' }, h('div', { class: 'ap-stage' }, svg), side), statusEl);
    renderHeader();
    render();
    // Le compteur de revenus avance chaque seconde.
    const tick = window.setInterval(renderIncome, 1000);
    offs.push(() => clearInterval(tick));
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
    let { zone, x, y } = cursor;
    x += dx;
    y += dy;
    if (zone === 'floor') {
      // Au fond de la pièce, on monte sur le mur correspondant.
      if (y < 0) ((zone = 'wall'), (x = N + Math.max(0, Math.min(N - 1, x))), (y = WALL_ROWS - 1));
      else if (x < 0) ((zone = 'wall'), (x = Math.max(0, Math.min(N - 1, y))), (y = WALL_ROWS - 1));
    } else if (y >= WALL_ROWS) {
      // Depuis le bas d'un mur, on redescend sur le sol.
      if (x >= N) ((zone = 'floor'), (x = x - N), (y = 0));
      else ((zone = 'floor'), (y = x), (x = 0));
    }
    const d = DIMS[zone];
    cursor = { zone, x: Math.max(0, Math.min(d.cols - 1, x)), y: Math.max(0, Math.min(d.rows - 1, y)) };
    render();
  };

  offs.push(
    pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'backspace') {
        e.preventDefault();
        if (hand) {
          hand = null;
          return render();
        }
        return navigate('/');
      }
      if (key === 'e') return toggleEdit();
      if (key === 'c') return void doCollect();
      if (!editing) return;
      if (key === 'arrowleft') move(-1, 0);
      else if (key === 'arrowright') move(1, 0);
      else if (key === 'arrowup') move(0, -1);
      else if (key === 'arrowdown') move(0, 1);
      else if (key === 'enter' || key === ' ') activate(cursor.zone, cursor.x, cursor.y);
      else if (key === 'delete' || key === 'x') {
        if (hand) {
          hand = null;
          render();
        } else {
          const p = occupant(cursor.zone, cursor.x, cursor.y);
          if (p) setLayout({ ...layout(), [cursor.zone]: layout()[cursor.zone].filter((q) => q !== p) });
        }
      } else if (key === 'p') {
        const p = occupant(cursor.zone, cursor.x, cursor.y);
        if (p && baseOf(p.i)?.id === 'frame') {
          pickingPhoto = p;
          render();
        }
      } else if (key === 'tab') {
        const used = new Set([...layout().floor, ...layout().wall].map((p) => p.o));
        const free = owned.filter((o) => !used.has(o.id));
        if (!free.length) return;
        const i = hand ? free.findIndex((o) => o.id === hand!.id) : -1;
        hand = free[(i + 1) % free.length];
        const zone = sizeOf(hand.item_id).place;
        if (zone !== cursor.zone) cursor = { zone, x: 0, y: 0 };
        render();
      } else return;
      e.preventDefault();
    }),
  );
  content.append(hints(['E', 'aménager'], ['C', 'récolter'], ['← ↑ → ↓', 'case'], ['Tab', 'meuble suivant'], ['Entrée', 'poser / reprendre'], ['Suppr', 'ranger'], ['P', 'photo du cadre'], ['Retour arrière', 'quitter']));

  return () => {
    disposed = true;
    clearTimeout(saveTimer);
    if (unsaved) void saveLayout(state.layout).catch(() => {}); // on quitte la page juste après un changement
    offs.forEach((off) => off());
  };
}
