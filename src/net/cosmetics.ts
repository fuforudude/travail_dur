// Apparence des joueurs (public.cosmetics) : couleur et effet du pseudo, titre, skins des jeux.
// Lue pour tous les joueurs qu'on croise (salon, discussion, partie, classements), avec un cache.

import { h } from '../ui/dom';
import { itemById, type SkinGame } from './shop';
import { getSupabase, multiConfigured } from './supabase';

export interface Cosmetic {
  name_color: string | null;
  name_effect: string | null;
  title: string | null;
  skins: Partial<Record<SkinGame, string>>;
}

const EMPTY: Cosmetic = { name_color: null, name_effect: null, title: null, skins: {} };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cache = new Map<string, { value: Cosmetic; at: number }>();
const queue = new Set<string>();
const inflight = new Set<string>();
let timer: number | undefined;
const listeners = new Set<() => void>();
const TTL = 60_000;

export function onCosmetics(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Apparence connue d'un joueur (vide en attendant le serveur, qui est interrogé en arrière-plan). */
export function cosmeticOf(id: string | null | undefined): Cosmetic {
  if (!id || !UUID_RE.test(id)) return EMPTY;
  const hit = cache.get(id);
  if (!hit || Date.now() - hit.at > TTL) request(id);
  return hit?.value ?? EMPTY;
}

/** Les demandes sont regroupées : une seule requête pour tous les pseudos d'une page. */
function request(id: string): void {
  if (!multiConfigured || inflight.has(id)) return;
  queue.add(id);
  timer ??= window.setTimeout(flush, 30);
}

async function flush(): Promise<void> {
  timer = undefined;
  const ids = [...queue].slice(0, 100);
  ids.forEach((id) => (queue.delete(id), inflight.add(id)));
  if (queue.size) timer = window.setTimeout(flush, 30);
  const supabase = await getSupabase();
  if (!supabase || !ids.length) return;
  const { data, error } = await supabase.from('cosmetics').select('user_id, name_color, name_effect, title, skins').in('user_id', ids);
  ids.forEach((id) => inflight.delete(id));
  const now = Date.now();
  if (error) {
    // Boutique pas encore installée : pseudos normaux, sans redemander à chaque affichage.
    for (const id of ids) cache.set(id, { value: EMPTY, at: now });
    return;
  }
  for (const id of ids) cache.set(id, { value: EMPTY, at: now });
  for (const row of (data ?? []) as (Cosmetic & { user_id: string })[]) {
    cache.set(row.user_id, { value: { name_color: row.name_color, name_effect: row.name_effect, title: row.title, skins: row.skins ?? {} }, at: now });
  }
  paintNames();
  listeners.forEach((cb) => cb());
}

/** Après un achat ou un changement d'équipement : on relit son apparence. */
export function invalidate(id: string): void {
  cache.delete(id);
  request(id);
}

// ---------------------------------------------------------------------------
// Pseudos
// ---------------------------------------------------------------------------

function decorate(el: HTMLElement, c: Cosmetic): void {
  const name = el.dataset.name ?? '';
  el.className = 'pseudo' + (c.name_color ? ` ${c.name_color}` : '') + (c.name_effect ? ` ${c.name_effect}` : '');
  const title = itemById(c.title);
  el.replaceChildren(h('span', { class: 'pseudo-text', 'data-text': name }, name), title ? h('span', { class: 'title-tag' }, title.name) : '');
}

/** Pseudo d'un joueur avec sa couleur, son effet et son titre (mis à jour quand ils arrivent). */
export function nameEl(id: string | null | undefined, name: string): HTMLElement {
  const el = h('span', { class: 'pseudo', 'data-name': name, 'data-uid': id ?? '' });
  decorate(el, cosmeticOf(id));
  return el;
}

function paintNames(): void {
  document.querySelectorAll<HTMLElement>('.pseudo[data-uid]').forEach((el) => {
    const id = el.dataset.uid;
    const hit = id ? cache.get(id) : undefined;
    if (hit) decorate(el, hit.value);
  });
}

// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------

/** Skin porté par chacun des deux joueurs dans ce jeu (null : apparence normale). */
export function skinsFor(game: SkinGame, ids: [string | null, string | null] | undefined): [string | null, string | null] {
  if (!ids) return [null, null];
  return [cosmeticOf(ids[0]).skins[game] ?? null, cosmeticOf(ids[1]).skins[game] ?? null];
}

/** Pose sur `el` les variables CSS des skins des deux joueurs (les autres sont retirées). */
export function applySkins(el: HTMLElement, game: SkinGame, ids: [string | null, string | null] | undefined): void {
  const skins = skinsFor(game, ids);
  const vars: Record<string, string> = {};
  skins.forEach((id, k) => Object.assign(vars, itemById(id)?.vars?.((k + 1) as 1 | 2) ?? {}));
  const key = JSON.stringify(vars);
  if (el.dataset.skins === key) return;
  for (const prop of (el.dataset.skinProps ?? '').split(' ').filter(Boolean)) el.style.removeProperty(prop);
  for (const [prop, value] of Object.entries(vars)) el.style.setProperty(prop, value);
  el.dataset.skins = key;
  el.dataset.skinProps = Object.keys(vars).join(' ');
}

/** Morpion : symbole de chaque joueur, skin compris. */
export function tttGlyphs(ids: [string | null, string | null] | undefined): [string, string] {
  const [a, b] = skinsFor('tictactoe', ids);
  return [itemById(a)?.glyph ?? '✕', itemById(b)?.glyph ?? '◯'];
}
