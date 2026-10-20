// Meubles : catalogue, finitions et géométrie de la pièce. Aucun accès au serveur ici
// (module utilisé tel quel par les tests). Mêmes identifiants, tailles et prix que
// public.furniture_bases et public.furniture_finishes ; footprint() comme public.apartment_save.

/** Sol carré N × N ; murs : x de 0 à N−1 = mur de gauche, de N à 2N−1 = mur de droite, sur 2 hauteurs. */
export const N = 8;
export const WALL_COLS = 2 * N;
export const WALL_ROWS = 2;

/** Nettoyage du début : mêmes coûts que public.apartment_clean_cost, dans le même ordre. */
export const CLEAN_TASKS: { name: string; cost: number }[] = [
  { name: 'Sortir les cartons', cost: 30 },
  { name: 'Jeter les ordures', cost: 80 },
  { name: 'Enlever les toiles d’araignée', cost: 150 },
  { name: 'Aspirer la poussière', cost: 300 },
  { name: 'Réparer le parquet', cost: 600 },
  { name: 'Repeindre les murs', cost: 1000 },
];
export const CLEAN_RATE = 20; // points par heure pour chaque tâche faite
export const CAP_HOURS = 24;
const RARITY_MULT: Record<string, number> = { standard: 1, common: 1.5, rare: 2.5, epic: 4, legendary: 8, mythic: 20 };

/** Revenu par heure d'un meuble posé (comme public.apartment_rate). */
export function itemIncome(item: string): number {
  const base = BASES.find((b) => b.id === item.split(':')[0]);
  const fin = FINISHES.find((f) => f.id === item.split(':')[1]);
  return ((base?.price ?? 0) / 10) * (RARITY_MULT[fin?.rarity ?? 'standard'] ?? 1);
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
  { id: 'chair', name: 'Chaise', glyph: '🪑', place: 'floor', w: 1, h: 1, price: 150 },
  { id: 'plant', name: 'Plante', glyph: '🪴', place: 'floor', w: 1, h: 1, price: 100 },
  { id: 'teddy', name: 'Nounours', glyph: '🧸', place: 'floor', w: 1, h: 1, price: 120 },
  { id: 'lamp', name: 'Lampe', glyph: '💡', place: 'floor', w: 1, h: 1, price: 150 },
  { id: 'books', name: 'Bibliothèque', glyph: '📚', place: 'floor', w: 1, h: 1, price: 300 },
  { id: 'guitar', name: 'Guitare', glyph: '🎸', place: 'floor', w: 1, h: 1, price: 400 },
  { id: 'tv', name: 'Télévision', glyph: '📺', place: 'floor', w: 1, h: 1, price: 500 },
  { id: 'computer', name: 'Ordinateur', glyph: '🖥️', place: 'floor', w: 1, h: 1, price: 700 },
  { id: 'aquarium', name: 'Aquarium', glyph: '🐠', place: 'floor', w: 1, h: 1, price: 700 },
  { id: 'arcade', name: 'Borne d’arcade', glyph: '🕹️', place: 'floor', w: 1, h: 1, price: 1000 },
  { id: 'trophy', name: 'Trophée', glyph: '🏆', place: 'floor', w: 1, h: 1, price: 1500 },
  { id: 'sofa', name: 'Canapé', glyph: '🛋️', place: 'floor', w: 2, h: 1, price: 600 },
  { id: 'bath', name: 'Baignoire', glyph: '🛁', place: 'floor', w: 2, h: 1, price: 900 },
  { id: 'piano', name: 'Piano', glyph: '🎹', place: 'floor', w: 2, h: 1, price: 1200 },
  { id: 'bed', name: 'Lit', glyph: '🛏️', place: 'floor', w: 2, h: 2, price: 800 },
  { id: 'frame', name: 'Cadre', glyph: '🖼️', place: 'wall', w: 1, h: 1, price: 300 },
  { id: 'window', name: 'Fenêtre', glyph: '🪟', place: 'wall', w: 1, h: 1, price: 400 },
  { id: 'clock', name: 'Horloge', glyph: '🕰️', place: 'wall', w: 1, h: 1, price: 250 },
  { id: 'mirror', name: 'Miroir', glyph: '🪞', place: 'wall', w: 1, h: 1, price: 300 },
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

export interface Placed {
  o: number; // meuble possédé
  i: string; // meuble (« sofa:gold »)
  x: number;
  y: number;
  r?: number; // orientation : 0 à 3 quarts de tour
  art?: number; // cadres : photo
}

export type Zone = 'floor' | 'wall';
export const ZONE_DIMS: Record<Zone, { cols: number; rows: number }> = { floor: { cols: N, rows: N }, wall: { cols: WALL_COLS, rows: WALL_ROWS } };

/**
 * Cases occupées par un meuble selon son orientation : au sol, un quart de tour échange largeur
 * et profondeur (un canapé 2 × 1 devient 1 × 2) ; au mur, toujours un emplacement.
 * Doit rester identique à public.apartment_save (0012_rotation.sql).
 */
export function footprint(item: string, r = 0): { w: number; h: number; place: Zone } {
  const b = baseOf(item);
  const w = b?.w ?? 1;
  const h = b?.h ?? 1;
  return r % 2 === 1 ? { w: h, h: w, place: b?.place ?? 'floor' } : { w, h, place: b?.place ?? 'floor' };
}

/** Le meuble en question est-il dans la case (x, y) ? */
export function covers(p: Placed, x: number, y: number): boolean {
  const f = footprint(p.i, p.r);
  return x >= p.x && x < p.x + f.w && y >= p.y && y < p.y + f.h;
}

/** Peut-on poser `item` (orientation r) en (x, y), sans déborder ni chevaucher un meuble de `others` ? */
export function fitsIn(others: Placed[], zone: Zone, item: string, r: number, x: number, y: number): boolean {
  const f = footprint(item, r);
  const d = ZONE_DIMS[zone];
  if (f.place !== zone || x < 0 || y < 0 || x + f.w > d.cols || y + f.h > d.rows) return false;
  for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) if (others.some((p) => covers(p, x + dx, y + dy))) return false;
  return true;
}
export interface Layout {
  floor: Placed[];
  wall: Placed[];
}
