import { isTyping, pushKeys } from '../core/input';
import { isAdmin } from '../net/admin';
import {
  artworks,
  baseOf,
  COLS,
  finishOf,
  FLOOR_ROWS,
  itemName,
  loadLayout,
  myFurniture,
  saveLayout,
  WALL_ROWS,
  type Artwork,
  type Layout,
  type Owned,
  type Placed,
} from '../net/apartment';
import { ensureAccount } from '../net/auth';
import { nameEl } from '../net/cosmetics';
import { getSupabase } from '../net/supabase';
import { navigate } from '../router';
import { h, hints } from './dom';
import { page } from './layout';

type Zone = 'wall' | 'floor';
const ROWS: Record<Zone, number> = { wall: WALL_ROWS, floor: FLOOR_ROWS };

/** Un meuble à l'écran : glyphe et finition (classe fin-*), ou photo pour un cadre. */
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
  let layout: Layout = { floor: [], wall: [] };
  let owned: Owned[] = [];
  let photos: Artwork[] = [];
  let editing = false;
  let hand: Owned | null = null; // meuble en main, à poser
  let cursor = { zone: 'floor' as Zone, x: 0, y: 0 };
  let status = '';
  let saveTimer: number | undefined;
  let unsaved = false;
  let pickingPhoto: Placed | null = null;

  const wallEl = h('div', { class: 'ap-wall' });
  const floorEl = h('div', { class: 'ap-floor' });
  const room = h('div', { class: 'ap-room' }, wallEl, floorEl);
  const side = h('aside', { class: 'ap-side card' });
  const statusEl = h('p', { class: 'status' });
  const header = h('div', { class: 'ap-head' });

  const mine = () => owner === me;
  const placedIds = () => new Set([...layout.floor, ...layout.wall].map((p) => p.o));
  const sizeOf = (item: string) => {
    const b = baseOf(item);
    return { w: b?.w ?? 1, h: b?.h ?? 1, place: (b?.place ?? 'floor') as Zone };
  };
  const occupant = (zone: Zone, x: number, y: number) =>
    layout[zone].find((p) => {
      const s = sizeOf(p.i);
      return x >= p.x && x < p.x + s.w && y >= p.y && y < p.y + s.h;
    });
  const fits = (item: string, zone: Zone, x: number, y: number) => {
    const s = sizeOf(item);
    if (s.place !== zone || x + s.w > COLS || y + s.h > ROWS[zone]) return false;
    for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) if (occupant(zone, x + dx, y + dy)) return false;
    return true;
  };

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    status = 'Modifications…';
    unsaved = true;
    saveTimer = window.setTimeout(async () => {
      unsaved = false;
      try {
        layout = await saveLayout(layout);
        status = 'Enregistré.';
      } catch (e) {
        status = (e as Error).message;
      }
      render();
    }, 700);
  };

  const place = (zone: Zone, x: number, y: number) => {
    if (!hand || !fits(hand.item_id, zone, x, y)) return;
    const entry: Placed = { o: hand.id, i: hand.item_id, x, y };
    layout = { ...layout, [zone]: [...layout[zone], entry] };
    const wasFrame = baseOf(hand.item_id)?.id === 'frame';
    hand = null;
    if (wasFrame && photos.length) pickingPhoto = entry;
    scheduleSave();
    render();
  };

  const pickUp = (zone: Zone, p: Placed) => {
    layout = { ...layout, [zone]: layout[zone].filter((q) => q !== p) };
    hand = owned.find((o) => o.id === p.o) ?? null;
    scheduleSave();
    render();
  };

  const removeAt = (zone: Zone, x: number, y: number) => {
    const p = occupant(zone, x, y);
    if (!p) return;
    layout = { ...layout, [zone]: layout[zone].filter((q) => q !== p) };
    scheduleSave();
    render();
  };

  const activate = (zone: Zone, x: number, y: number) => {
    if (!editing) return;
    cursor = { zone, x, y };
    if (hand) return place(zone, x, y);
    const p = occupant(zone, x, y);
    if (p) pickUp(zone, p);
  };

  const setPhoto = (p: Placed, art: number | undefined) => {
    layout = { ...layout, wall: layout.wall.map((q) => (q === p ? { ...q, art } : q)) };
    pickingPhoto = null;
    scheduleSave();
    render();
  };

  const drawZone = (zone: Zone, el: HTMLElement) => {
    const children: HTMLElement[] = [];
    // Cases (cibles du clic, du survol et du curseur clavier)
    for (let y = 0; y < ROWS[zone]; y++)
      for (let x = 0; x < COLS; x++) {
        const cell = h('div', { class: 'ap-cell' + (editing && cursor.zone === zone && cursor.x === x && cursor.y === y ? ' cursor' : '') });
        cell.style.gridArea = `${y + 1} / ${x + 1}`;
        cell.addEventListener('mouseenter', () => {
          if (!editing) return;
          cursor = { zone, x, y };
          render();
        });
        cell.addEventListener('click', () => activate(zone, x, y));
        children.push(cell);
      }
    for (const p of layout[zone]) {
      const s = sizeOf(p.i);
      const art = p.art ? photos.find((a) => a.id === p.art) : undefined;
      const el2 = h('div', { class: `ap-item rar-${finishOf(p.i).rarity}` }, furnitureEl(p.i, art));
      el2.style.gridArea = `${p.y + 1} / ${p.x + 1} / span ${s.h} / span ${s.w}`;
      el2.style.setProperty('--s', String(Math.min(s.w, s.h)));
      el2.addEventListener('click', () => activate(zone, p.x, p.y));
      children.push(el2);
    }
    // Aperçu du meuble en main
    if (editing && hand && cursor.zone === zone) {
      const s = sizeOf(hand.item_id);
      const ghost = h('div', { class: 'ap-item ghost' + (fits(hand.item_id, zone, cursor.x, cursor.y) ? '' : ' bad') }, furnitureEl(hand.item_id));
      ghost.style.gridArea = `${cursor.y + 1} / ${cursor.x + 1} / span ${s.h} / span ${s.w}`;
      ghost.style.setProperty('--s', String(Math.min(s.w, s.h)));
      children.push(ghost);
    }
    el.replaceChildren(...children);
  };

  const render = () => {
    drawZone('wall', wallEl);
    drawZone('floor', floorEl);
    room.classList.toggle('editing', editing);
    statusEl.textContent = status;
    if (!mine()) {
      side.hidden = true;
      return;
    }
    side.hidden = !editing;
    if (!editing) return;
    const used = placedIds();
    const free = owned.filter((o) => !used.has(o.id) && o.id !== hand?.id);
    const list = free.length
      ? free.map((o) => {
          const b = h('button', { class: `ap-inv rar-${finishOf(o.item_id).rarity}`, type: 'button' }, furnitureEl(o.item_id), h('span', {}, itemName(o.item_id)));
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', () => {
            hand = o;
            cursor.zone = sizeOf(o.item_id).place;
            render();
          });
          return b;
        })
      : [h('p', { class: 'muted small' }, 'Tous tes meubles sont placés. Il y en a d’autres dans les caisses.')];
    const photoPicker = pickingPhoto
      ? h(
          'div',
          { class: 'ap-photos' },
          h('h3', {}, 'Photo du cadre'),
          ...photos.map((a) => {
            const b = h('button', { class: 'ap-photo', type: 'button', title: a.title }, h('img', { src: a.url, alt: a.title, loading: 'lazy' }));
            b.addEventListener('click', () => setPhoto(pickingPhoto!, a.id));
            return b;
          }),
          (() => {
            const none = h('button', { class: 'field', type: 'button' }, 'Cadre vide');
            none.addEventListener('click', () => setPhoto(pickingPhoto!, undefined));
            return none;
          })(),
        )
      : null;
    side.replaceChildren(
      h('h2', {}, hand ? `En main : ${itemName(hand.item_id)}` : 'Mes meubles'),
      hand ? h('p', { class: 'muted small' }, 'Clique une case libre (ou Entrée) pour le poser ; Suppr pour le ranger.') : '',
      photoPicker ?? '',
      h('div', { class: 'ap-inventory' }, ...list),
    );
  };

  const toggleEdit = () => {
    if (!mine()) return;
    editing = !editing;
    hand = null;
    pickingPhoto = null;
    renderHeader();
    render();
  };

  let ownerName = '';
  const renderHeader = () => {
    const link = `${location.origin}${location.pathname}#/appart/${owner}`;
    const copy = h('button', { class: 'field', type: 'button' }, 'Copier le lien');
    copy.addEventListener('click', () =>
      navigator.clipboard?.writeText(link).then(
        () => ((status = 'Lien copié.'), render()),
        () => ((status = link), render()),
      ),
    );
    const edit = h('button', { class: 'field' + (editing ? ' on' : ''), type: 'button' }, editing ? 'Terminer' : 'Aménager (E)');
    edit.addEventListener('click', toggleEdit);
    const crates = h('button', { class: 'field', type: 'button' }, 'Meubles et caisses');
    crates.addEventListener('click', () => navigate('/caisses'));
    header.replaceChildren(
      h('h1', {}, mine() ? 'Mon appart' : h('span', {}, 'Appart de ', nameEl(owner, ownerName))),
      h('div', { class: 'ap-actions' }, copy, mine() ? edit : '', mine() ? crates : ''),
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
    const [l, p, prof] = await Promise.all([loadLayout(owner), artworks(), supabase!.from('profiles').select('username').eq('id', owner).maybeSingle()]);
    if (disposed) return;
    layout = l;
    photos = p;
    ownerName = (prof.data?.username as string | undefined) ?? 'Inconnu';
    if (mine()) owned = await myFurniture(me);
    if (disposed) return;
    wrap.replaceChildren(header, h('div', { class: 'ap-main' }, room, side), statusEl);
    renderHeader();
    render();
    // Visite : l'appart se met à jour en direct quand son propriétaire le modifie.
    if (!mine() && supabase) {
      const ch = supabase
        .channel(`appart:${owner}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'apartments', filter: `user_id=eq.${owner}` }, (e) => {
          const next = (e.new as { layout?: Layout }).layout;
          if (next) {
            layout = { floor: next.floor ?? [], wall: next.wall ?? [] };
            render();
          }
        })
        .subscribe();
      offs.push(() => void supabase.removeChannel(ch));
    }
  })().catch((e: Error) => !disposed && wrap.replaceChildren(h('p', { class: 'notice' }, e.message)));

  const move = (dx: number, dy: number) => {
    let { zone, x, y } = cursor;
    x = Math.max(0, Math.min(COLS - 1, x + dx));
    y += dy;
    if (zone === 'wall' && y >= WALL_ROWS) ((zone = 'floor'), (y = 0));
    else if (zone === 'floor' && y < 0) ((zone = 'wall'), (y = WALL_ROWS - 1));
    y = Math.max(0, Math.min(ROWS[zone] - 1, y));
    cursor = { zone, x, y };
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
      if (!editing) return;
      if (key === 'arrowleft') move(-1, 0);
      else if (key === 'arrowright') move(1, 0);
      else if (key === 'arrowup') move(0, -1);
      else if (key === 'arrowdown') move(0, 1);
      else if (key === 'enter' || key === ' ') activate(cursor.zone, cursor.x, cursor.y);
      else if (key === 'delete' || key === 'x') {
        if (hand) hand = null;
        else removeAt(cursor.zone, cursor.x, cursor.y);
        render();
      } else if (key === 'p') {
        const p = occupant(cursor.zone, cursor.x, cursor.y);
        if (p && baseOf(p.i)?.id === 'frame') {
          pickingPhoto = p;
          render();
        }
      } else if (key === 'tab') {
        // Prend le meuble suivant de l'inventaire.
        const used = placedIds();
        const free = owned.filter((o) => !used.has(o.id));
        if (!free.length) return;
        const i = hand ? free.findIndex((o) => o.id === hand!.id) : -1;
        hand = free[(i + 1) % free.length];
        cursor.zone = sizeOf(hand.item_id).place;
        if (cursor.y >= ROWS[cursor.zone]) cursor.y = 0;
        render();
      } else return;
      e.preventDefault();
    }),
  );
  content.append(hints(['E', 'aménager'], ['← ↑ → ↓', 'case'], ['Tab', 'meuble suivant'], ['Entrée', 'poser / reprendre'], ['Suppr', 'ranger'], ['P', 'photo du cadre'], ['Retour arrière', 'quitter']));

  return () => {
    disposed = true;
    clearTimeout(saveTimer);
    if (unsaved) void saveLayout(layout).catch(() => {}); // on quitte la page juste après un changement
    offs.forEach((off) => off());
  };
}
