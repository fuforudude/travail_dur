// Appartement, meubles et caisses (supabase/migrations/0009_appart_admin.sql).
// Le serveur fait foi pour les prix, les tirages et l'aménagement ; ici, l'apparence des meubles.

import { serverError, rpc } from './admin';
import { getSupabase } from './supabase';

/** Sol carré N × N ; murs : x de 0 à N−1 = mur de gauche, de N à 2N−1 = mur de droite, sur 2 hauteurs. */
export const N = 8;
export const WALL_COLS = 2 * N;
export const WALL_ROWS = 2;

/** Nettoyage du début : mêmes coûts que public.apartment_clean_cost, dans le même ordre. */
export const CLEAN_TASKS: { name: string; cost: number }[] = [
  { name: 'Sortir les cartons', cost: 300 },
  { name: 'Jeter les ordures', cost: 800 },
  { name: 'Enlever les toiles d’araignée', cost: 1500 },
  { name: 'Aspirer la poussière', cost: 3000 },
  { name: 'Réparer le parquet', cost: 6000 },
  { name: 'Repeindre les murs', cost: 10000 },
];
export const CLEAN_RATE = 20; // points par heure pour chaque tâche faite
export const CAP_HOURS = 24;
const RARITY_MULT: Record<string, number> = { standard: 1, common: 1.5, rare: 2.5, epic: 4, legendary: 8, mythic: 20 };

/** Revenu par heure d'un meuble posé (comme public.apartment_rate). */
export function itemIncome(item: string): number {
  const base = BASES.find((b) => b.id === item.split(':')[0]);
  const fin = FINISHES.find((f) => f.id === item.split(':')[1]);
  return ((base?.price ?? 0) / 40) * (RARITY_MULT[fin?.rarity ?? 'standard'] ?? 1);
}

export interface Base {
  id: string;
  name: string;
  glyph: string;
  place: 'floor' | 'wall';
  w: number;
  h: number;
  price: number;
}

/** Mêmes identifiants, emplacements, tailles et prix que public.furniture_bases. */
export const BASES: Base[] = [
  { id: 'chair', name: 'Chaise', glyph: '🪑', place: 'floor', w: 1, h: 1, price: 800 },
  { id: 'plant', name: 'Plante', glyph: '🪴', place: 'floor', w: 1, h: 1, price: 600 },
  { id: 'teddy', name: 'Nounours', glyph: '🧸', place: 'floor', w: 1, h: 1, price: 700 },
  { id: 'lamp', name: 'Lampe', glyph: '💡', place: 'floor', w: 1, h: 1, price: 900 },
  { id: 'books', name: 'Bibliothèque', glyph: '📚', place: 'floor', w: 1, h: 1, price: 1500 },
  { id: 'guitar', name: 'Guitare', glyph: '🎸', place: 'floor', w: 1, h: 1, price: 2000 },
  { id: 'tv', name: 'Télévision', glyph: '📺', place: 'floor', w: 1, h: 1, price: 2500 },
  { id: 'computer', name: 'Ordinateur', glyph: '🖥️', place: 'floor', w: 1, h: 1, price: 3500 },
  { id: 'aquarium', name: 'Aquarium', glyph: '🐠', place: 'floor', w: 1, h: 1, price: 3500 },
  { id: 'arcade', name: 'Borne d’arcade', glyph: '🕹️', place: 'floor', w: 1, h: 1, price: 5000 },
  { id: 'trophy', name: 'Trophée', glyph: '🏆', place: 'floor', w: 1, h: 1, price: 8000 },
  { id: 'sofa', name: 'Canapé', glyph: '🛋️', place: 'floor', w: 2, h: 1, price: 3000 },
  { id: 'bath', name: 'Baignoire', glyph: '🛁', place: 'floor', w: 2, h: 1, price: 4500 },
  { id: 'piano', name: 'Piano', glyph: '🎹', place: 'floor', w: 2, h: 1, price: 6000 },
  { id: 'bed', name: 'Lit', glyph: '🛏️', place: 'floor', w: 2, h: 2, price: 4000 },
  { id: 'frame', name: 'Cadre', glyph: '🖼️', place: 'wall', w: 1, h: 1, price: 1500 },
  { id: 'window', name: 'Fenêtre', glyph: '🪟', place: 'wall', w: 1, h: 1, price: 2000 },
  { id: 'clock', name: 'Horloge', glyph: '🕰️', place: 'wall', w: 1, h: 1, price: 1200 },
  { id: 'mirror', name: 'Miroir', glyph: '🪞', place: 'wall', w: 1, h: 1, price: 1500 },
];

export type Rarity = 'standard' | 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

/** Finitions (classe CSS fin-<id>) : mêmes identifiants et raretés que public.furniture_finishes. */
export const FINISHES: { id: string; name: string; rarity: Rarity }[] = [
  { id: 'standard', name: 'Standard', rarity: 'standard' },
  { id: 'ruby', name: 'Rubis', rarity: 'common' },
  { id: 'ocean', name: 'Océan', rarity: 'common' },
  { id: 'jade', name: 'Jade', rarity: 'common' },
  { id: 'pastel', name: 'Pastel', rarity: 'rare' },
  { id: 'night', name: 'Nuit', rarity: 'rare' },
  { id: 'gold', name: 'Or', rarity: 'epic' },
  { id: 'neon', name: 'Néon', rarity: 'epic' },
  { id: 'diamond', name: 'Diamant', rarity: 'legendary' },
  { id: 'obsidian', name: 'Obsidienne', rarity: 'legendary' },
  { id: 'rainbow', name: 'Arc-en-ciel', rarity: 'mythic' },
  { id: 'ghost', name: 'Spectre', rarity: 'mythic' },
];

export const RARITY_NAMES: Record<Rarity, string> = {
  standard: 'Standard',
  common: 'Commun',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
  mythic: 'Mythique',
};

export const CRATES: { id: string; name: string; text: string }[] = [
  { id: 'classic', name: 'Caisse classique', text: 'Toutes les finitions, de Commun à Mythique.' },
  { id: 'prestige', name: 'Caisse prestige', text: 'Rien en dessous de Rare, et bien plus de chances de Légendaire et Mythique.' },
];

export const baseOf = (item: string) => BASES.find((b) => b.id === item.split(':')[0]);
export const finishOf = (item: string) => FINISHES.find((f) => f.id === item.split(':')[1]) ?? FINISHES[0];
export const itemName = (item: string) => {
  const f = finishOf(item);
  return `${baseOf(item)?.name ?? item}${f.id === 'standard' ? '' : ` ${f.name}`}`;
};
/** Tous les meubles d'une rareté (pour l'animation des caisses). */
export const itemsOfRarity = (r: Rarity) => BASES.flatMap((b) => FINISHES.filter((f) => f.rarity === r).map((f) => `${b.id}:${f.id}`));

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

export interface Placed {
  o: number; // meuble possédé
  i: string; // meuble (« sofa:gold »)
  x: number;
  y: number;
  art?: number; // cadres : photo
}
export interface Layout {
  floor: Placed[];
  wall: Placed[];
}
export interface Owned {
  id: number;
  item_id: string;
}
export interface Artwork {
  id: number;
  title: string;
  url: string;
}

async function client() {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Serveur non configuré');
  return supabase;
}

export interface ApartmentState {
  layout: Layout;
  cleanStep: number;
  rate: number; // points par heure
  banked: number;
  lastTick: number; // ms
}

export async function loadApartment(uid: string): Promise<ApartmentState> {
  const { data, error } = await (await client()).from('apartments').select('layout, clean_step, rate, banked, last_tick').eq('user_id', uid).maybeSingle();
  if (error) throw serverError(error);
  const l = (data?.layout as Layout | undefined) ?? { floor: [], wall: [] };
  return {
    layout: { floor: l.floor ?? [], wall: l.wall ?? [] },
    cleanStep: Number(data?.clean_step ?? 0),
    rate: Number(data?.rate ?? 0),
    banked: Number(data?.banked ?? 0),
    lastTick: data?.last_tick ? Date.parse(data.last_tick as string) : Date.now(),
  };
}

/** Revenus accumulés à l'instant t (même calcul que public.apartment_settle). */
export function pending(a: ApartmentState, t = Date.now()): number {
  return Math.min(a.banked + (a.rate * (t - a.lastTick)) / 3_600_000, Math.max(a.rate, 1) * CAP_HOURS);
}

export const cleanApartment = () => rpc<{ balance: number; clean_step: number }>('apartment_clean');
export const collectIncome = () => rpc<{ gain: number }>('apartment_collect');

export async function myFurniture(uid: string): Promise<Owned[]> {
  const { data, error } = await (await client()).from('furniture_owned').select('id, item_id').eq('user_id', uid).order('id');
  if (error) throw serverError(error);
  return ((data as Owned[] | null) ?? []).map((o) => ({ ...o, id: Number(o.id) }));
}

export async function artworks(): Promise<Artwork[]> {
  const { data, error } = await (await client()).from('artworks').select('id, title, url').order('id');
  if (error) throw serverError(error);
  return ((data as Artwork[] | null) ?? []).map((a) => ({ ...a, id: Number(a.id) }));
}

export async function crateInfo(): Promise<{ prices: Map<string, number>; odds: Map<string, [Rarity, number][]> }> {
  const supabase = await client();
  const [c, o] = await Promise.all([supabase.from('crates').select('id, price'), supabase.from('crate_odds').select('crate_id, rarity, weight')]);
  if (c.error) throw serverError(c.error);
  if (o.error) throw serverError(o.error);
  const odds = new Map<string, [Rarity, number][]>();
  for (const r of (o.data ?? []) as { crate_id: string; rarity: Rarity; weight: number }[]) {
    odds.set(r.crate_id, [...(odds.get(r.crate_id) ?? []), [r.rarity, r.weight]]);
  }
  return { prices: new Map((c.data ?? []).map((r: { id: string; price: number }) => [r.id, Number(r.price)])), odds };
}

export const buyFurniture = (base: string) => rpc<{ balance: number; owned: number; item: string }>('furniture_buy', { base_id: base });
export const openCrate = (crate: string) => rpc<{ balance: number; owned: number; item: string; rarity: Rarity }>('crate_open', { crate });
export const saveLayout = (layout: Layout) =>
  rpc<Layout>('apartment_save', {
    layout: {
      floor: layout.floor.map(({ o, x, y }) => ({ o, x, y })),
      wall: layout.wall.map(({ o, x, y, art }) => (art ? { o, x, y, art } : { o, x, y })),
    },
  });
