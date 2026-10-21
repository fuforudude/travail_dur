// Meubles : catalogue, finitions, pièces et leur géométrie. Aucun accès au serveur ici
// (module utilisé tel quel par les tests). Mêmes identifiants, tailles et prix que
// public.furniture_bases et public.furniture_finishes ; footprint() et fitsIn() comme public.apartment_save.

export const WALL_ROWS = 2;

/**
 * Pièces (comme public.apartment_room) : sol w × d (w le long de x, d le long de y) ;
 * murs : x de 0 à d − 1 = mur de gauche, de d à d + w − 1 = mur de droite, sur WALL_ROWS hauteurs.
 * On commence avec l'entrée ; les autres s'achètent dans n'importe quel ordre.
 * Portes : chacune occupe toute la hauteur de la colonne de mur x (comme public.apartment_room_doors) ;
 * le plan est un arbre autour de l'entrée, chaque porte a sa réciproque dans l'autre pièce.
 */
export interface Room {
  id: string;
  name: string;
  glyph: string;
  w: number;
  d: number;
  doors: { to: string; x: number }[];
  /** Pièce de luxe : prix fixe, accessible seulement depuis la pièce `requires` (par sa porte). */
  price?: number;
  requires?: string;
}
export const ROOMS: Room[] = [
  { id: 'entree', name: 'Entrée', glyph: '🚪', w: 6, d: 5, doors: [{ to: 'salon', x: 2 }, { to: 'chambre', x: 6 }, { to: 'sdb', x: 9 }] },
  { id: 'salon', name: 'Salon', glyph: '🛋️', w: 8, d: 7, doors: [{ to: 'entree', x: 3 }, { to: 'cuisine', x: 9 }, { to: 'jeux', x: 13 }] },
  { id: 'cuisine', name: 'Cuisine', glyph: '🍳', w: 7, d: 6, doors: [{ to: 'salon', x: 2 }] },
  { id: 'chambre', name: 'Chambre', glyph: '🛏️', w: 7, d: 7, doors: [{ to: 'entree', x: 3 }, { to: 'bureau', x: 11 }] },
  { id: 'sdb', name: 'Salle de bain', glyph: '🛁', w: 6, d: 5, doors: [{ to: 'entree', x: 2 }] },
  { id: 'bureau', name: 'Bureau', glyph: '🖥️', w: 6, d: 6, doors: [{ to: 'chambre', x: 2 }, { to: 'coffres', x: 8 }] },
  { id: 'jeux', name: 'Salle de jeux', glyph: '🕹️', w: 8, d: 8, doors: [{ to: 'salon', x: 3 }, { to: 'bar', x: 12 }] },
  // Pièces de luxe, hors de la suite de prix, chacune avec son équipement spécial (SPECIALS).
  { id: 'bar', name: 'Bar', glyph: '🍺', w: 8, d: 6, doors: [{ to: 'jeux', x: 2 }, { to: 'toit', x: 10 }], price: 1_000_000, requires: 'jeux' },
  { id: 'coffres', name: 'Salle des coffres', glyph: '🏦', w: 6, d: 6, doors: [{ to: 'bureau', x: 2 }], price: 2_500_000, requires: 'bureau' },
  { id: 'toit', name: 'Toit-terrasse', glyph: '🌴', w: 9, d: 8, doors: [{ to: 'bar', x: 3 }], price: 5_000_000, requires: 'bar' },
];
export const roomOf = (id: string) => ROOMS.find((r) => r.id === id) ?? ROOMS[0];
/** Prix de la pièce suivante selon le nombre déjà achetées (comme public.apartment_room_cost). */
export const ROOM_COSTS = [3000, 8000, 20000, 50000, 120000, 300000];
/** Prix d'une pièce (comme public.apartment_room_buy) : fixe pour une pièce de luxe, sinon selon les pièces normales déjà achetées. */
export function roomCost(id: string, owned: string[]): number | undefined {
  const r = roomOf(id);
  if (r.price) return r.price;
  return ROOM_COSTS[owned.filter((o) => o !== 'entree' && !roomOf(o).price).length];
}

/**
 * Équipements spéciaux des pièces de luxe (comme public.apartment_specials) : posés au sol à une place
 * fixe, réservée (aucun meuble dessus), visibles grisés tant qu'ils ne sont pas achetés.
 */
export interface Special {
  id: string;
  room: string;
  name: string;
  glyph: string;
  cost: number;
  effect: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export const SPECIALS: Special[] = [
  { id: 'jager', room: 'bar', name: 'Tireuse à Jäger', glyph: '🦌', cost: 1_000_000, effect: 'Revenus de l’appart × 2', x: 1, y: 0, w: 3, h: 1 },
  { id: 'coffre', room: 'coffres', name: 'Coffre-fort blindé', glyph: '💰', cost: 2_000_000, effect: 'Les revenus s’accumulent 72 h hors du site (au lieu de 24 h)', x: 3, y: 0, w: 2, h: 2 },
  { id: 'jacuzzi', room: 'toit', name: 'Jacuzzi en or', glyph: '🛁', cost: 5_000_000, effect: 'Revenus de l’appart × 1,5 (en plus de la tireuse)', x: 5, y: 2, w: 2, h: 2 },
];
export const specialOf = (room: string) => SPECIALS.find((s) => s.room === room);
/** Multiplicateur des revenus selon les équipements achetés (comme public.apartment_mult). */
export const incomeMult = (specials: string[]) => (specials.includes('jager') ? 2 : 1) * (specials.includes('jacuzzi') ? 1.5 : 1);
/** Plafond des revenus accumulés, en heures (comme public.apartment_cap_hours). */
export const capHours = (specials: string[]) => (specials.includes('coffre') ? 72 : CAP_HOURS);

/** Nettoyage du début : mêmes coûts que public.apartment_clean_cost, dans le même ordre. */
export const CLEAN_TASKS: { name: string; cost: number }[] = [
  { name: 'Sortir les cartons', cost: 30 },
  { name: 'Jeter les ordures', cost: 80 },
  { name: 'Enlever les toiles d’araignée', cost: 150 },
  { name: 'Aspirer la poussière', cost: 300 },
  { name: 'Réparer le parquet', cost: 600 },
  { name: 'Repeindre les murs', cost: 1000 },
];
export const CLEAN_RATE = 200; // points par heure pour chaque tâche faite (comme public.apartment_rate)
export const CAP_HOURS = 24;
const RARITY_MULT: Record<string, number> = { standard: 1, common: 1.5, rare: 2.5, epic: 4, legendary: 8, mythic: 20, divine: 60 };

/** Revenu par heure d'un meuble posé (comme public.apartment_rate). */
export function itemIncome(item: string): number {
  const base = BASES.find((b) => b.id === item.split(':')[0]);
  const fin = FINISHES.find((f) => f.id === item.split(':')[1]);
  return (base?.price ?? 0) * 0.8 * (RARITY_MULT[fin?.rarity ?? 'standard'] ?? 1);
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
  { id: 'frame', name: 'Cadre', glyph: '🖼️', place: 'wall', w: 2, h: 1, price: 300 },
  { id: 'window', name: 'Fenêtre', glyph: '🪟', place: 'wall', w: 1, h: 1, price: 400 },
  { id: 'clock', name: 'Horloge', glyph: '🕰️', place: 'wall', w: 1, h: 1, price: 250 },
  { id: 'mirror', name: 'Miroir', glyph: '🪞', place: 'wall', w: 1, h: 1, price: 300 },
];

export type Rarity = 'standard' | 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'divine';

/** Finitions (classe CSS fin-<id>) : mêmes identifiants et raretés que public.furniture_finishes. */
export const FINISHES: { id: string; name: string; rarity: Rarity; motif?: boolean }[] = [
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
  { id: 'cosmos', name: 'Cosmos', rarity: 'divine' },
  { id: 'aurore', name: 'Aurore', rarity: 'divine' },
  // Versions décorées : le meuble garde sa couleur, avec des motifs en plus (dessinés dans furnitureArt.ts).
  { id: 'fleurs', name: 'à fleurs', rarity: 'common', motif: true },
  { id: 'coeurs', name: 'à cœurs', rarity: 'common', motif: true },
  { id: 'etoiles', name: 'à étoiles', rarity: 'rare', motif: true },
  { id: 'pics', name: 'à pics', rarity: 'epic', motif: true },
  { id: 'arcs', name: 'à arcs-en-ciel', rarity: 'epic', motif: true },
  { id: 'nounours', name: 'à nounours', rarity: 'legendary', motif: true },
  { id: 'flammes', name: 'en flammes', rarity: 'legendary', motif: true },
  { id: 'couronne', name: 'à couronne', rarity: 'mythic', motif: true },
  // Personnalisable : une fois posé, le meuble est recouvert d'une photo débloquée, en papier peint.
  { id: 'perso', name: 'personnalisable', rarity: 'mythic' },
];

export const RARITY_NAMES: Record<Rarity, string> = {
  standard: 'Standard',
  common: 'Commun',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
  mythic: 'Mythique',
  divine: 'Divin',
};

export const CRATES: { id: string; name: string; text: string }[] = [
  { id: 'classic', name: 'Caisse classique', text: 'Toutes les finitions, de Commun à Mythique.' },
  { id: 'prestige', name: 'Caisse prestige', text: 'Rien en dessous de Rare, et bien plus de chances de Légendaire et Mythique.' },
  { id: 'royale', name: 'Caisse royale', text: 'Rien en dessous de Légendaire, et 4 % de chances de Divin (revenu × 60), introuvable ailleurs.' },
  { id: 'divine', name: 'Caisse divine', text: 'Mythique ou Divin, rien d’autre : 40 % de chances de Divin.' },
  { id: 'photos', name: 'Caisse souvenirs', text: '5 % de chances de débloquer une photo pour tes cadres ; sinon un meuble, comme la caisse classique.' },
];

/** Caisse souvenirs : chance de débloquer une photo (comme public.crate_open). */
export const PHOTO_CHANCE = 0.05;

/** Peut-on mettre une photo sur ce meuble (cadre, ou meuble personnalisable) ? Comme public.apartment_save. */
export const takesPhoto = (item: string) => item.split(':')[0] === 'frame' || item.split(':')[1] === 'perso';
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
export function zoneDims(room: string, zone: Zone): { cols: number; rows: number } {
  const r = roomOf(room);
  return zone === 'floor' ? { cols: r.w, rows: r.d } : { cols: r.d + r.w, rows: WALL_ROWS };
}

/**
 * Cases occupées par un meuble selon son orientation : au sol, un quart de tour échange largeur
 * et profondeur (un canapé 2 × 1 devient 1 × 2) ; au mur, l'emprise ne change pas (un cadre fait
 * toujours 2 emplacements de large). Doit rester identique à public.apartment_save (0013_pieces.sql).
 */
export function footprint(item: string, r = 0): { w: number; h: number; place: Zone } {
  const b = baseOf(item);
  const w = b?.w ?? 1;
  const h = b?.h ?? 1;
  const place = b?.place ?? 'floor';
  return place === 'floor' && r % 2 === 1 ? { w: h, h: w, place } : { w, h, place };
}

/** Le meuble en question est-il dans la case (x, y) ? */
export function covers(p: Placed, x: number, y: number): boolean {
  const f = footprint(p.i, p.r);
  return x >= p.x && x < p.x + f.w && y >= p.y && y < p.y + f.h;
}

/**
 * Peut-on poser `item` (orientation r) en (x, y) dans la pièce `room`, sans déborder, sans être
 * à cheval sur les deux murs, ni devant une porte, ni sur la place d'un équipement spécial, ni
 * chevaucher un meuble de `others` ?
 */
export function fitsIn(others: Placed[], room: string, zone: Zone, item: string, r: number, x: number, y: number): boolean {
  const f = footprint(item, r);
  const d = zoneDims(room, zone);
  if (f.place !== zone || x < 0 || y < 0 || x + f.w > d.cols || y + f.h > d.rows) return false;
  const corner = roomOf(room).d;
  if (zone === 'wall' && x < corner && x + f.w > corner) return false;
  if (zone === 'wall' && roomOf(room).doors.some((dr) => dr.x >= x && dr.x < x + f.w)) return false;
  const sp = specialOf(room);
  if (zone === 'floor' && sp && x < sp.x + sp.w && sp.x < x + f.w && y < sp.y + sp.h && sp.y < y + f.h) return false;
  for (let dy = 0; dy < f.h; dy++) for (let dx = 0; dx < f.w; dx++) if (others.some((p) => covers(p, x + dx, y + dy))) return false;
  return true;
}
export interface RoomLayout {
  floor: Placed[];
  wall: Placed[];
}
/** Aménagement de chaque pièce débloquée, par identifiant de pièce. */
export type Layout = Record<string, RoomLayout>;
