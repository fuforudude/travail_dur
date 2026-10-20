// Boutique : apparence de chaque objet. Le prix et la disponibilité font foi côté serveur
// (public.shop_items, supabase/migrations/0008_boutique.sql), avec les mêmes identifiants.

import { errorMessage, getSupabase } from './supabase';

export type Slot = 'name_color' | 'name_effect' | 'title' | `skin:${SkinGame}`;
export type SkinGame = 'connect4' | 'tictactoe' | 'chess' | 'checkers' | 'quoridor';

/** Variables CSS posées sur le plateau pour le joueur 1 (`side` 1) ou 2. */
type Vars = (side: 1 | 2) => Record<string, string>;

export interface Item {
  id: string;
  slot: Slot;
  name: string;
  /** Prix affiché à titre indicatif ; le serveur envoie le vrai prix. */
  price: number;
  /** Skins : variables CSS à poser sur le plateau. */
  vars?: Vars;
  /** Morpion : symbole du joueur. */
  glyph?: string;
}

/** Échecs : pièces claires (joueur 1, les blancs) ou foncées (joueur 2), avec leur contour. */
const chessVars =
  (light: string, lightEdge: string, dark: string, darkEdge: string): Vars =>
  (side): Record<string, string> =>
    side === 1 ? { '--ch-w': light, '--ch-w-edge': lightEdge } : { '--ch-b': dark, '--ch-b-edge': darkEdge };

export const ITEMS: Item[] = [
  // Couleurs de pseudo (classes nc-* dans styles.css)
  { id: 'nc-ruby', slot: 'name_color', name: 'Rubis', price: 5000 },
  { id: 'nc-emerald', slot: 'name_color', name: 'Émeraude', price: 5000 },
  { id: 'nc-sapphire', slot: 'name_color', name: 'Saphir', price: 5000 },
  { id: 'nc-amethyst', slot: 'name_color', name: 'Améthyste', price: 8000 },
  { id: 'nc-gold', slot: 'name_color', name: 'Or', price: 20000 },
  { id: 'nc-ice', slot: 'name_color', name: 'Givre', price: 35000 },
  { id: 'nc-sunset', slot: 'name_color', name: 'Coucher de soleil', price: 50000 },
  { id: 'nc-rainbow', slot: 'name_color', name: 'Arc-en-ciel', price: 150000 },
  // Effets de pseudo (classes ne-*)
  { id: 'ne-glow', slot: 'name_effect', name: 'Halo', price: 15000 },
  { id: 'ne-pulse', slot: 'name_effect', name: 'Battement', price: 25000 },
  { id: 'ne-shine', slot: 'name_effect', name: 'Reflet', price: 60000 },
  { id: 'ne-glitch', slot: 'name_effect', name: 'Glitch', price: 90000 },
  { id: 'ne-sparkle', slot: 'name_effect', name: 'Étincelles', price: 120000 },
  { id: 'ne-fire', slot: 'name_effect', name: 'Flammes', price: 250000 },
  // Skins : Puissance 4 (jetons)
  { id: 'c4-neon', slot: 'skin:connect4', name: 'Néon', price: 30000, vars: (s) => ({ [`--c4-disc-${s}`]: s === 1 ? 'radial-gradient(circle, #fff 0 18%, #ff2bd6 20% 62%, #7a0d6c 100%)' : 'radial-gradient(circle, #fff 0 18%, #2bf3ff 20% 62%, #0b5c7a 100%)' }) },
  { id: 'c4-gold', slot: 'skin:connect4', name: 'Pièces d’or', price: 20000, vars: (s) => ({ [`--c4-disc-${s}`]: 'radial-gradient(circle at 35% 30%, #fff6c4, #f1c232 45%, #9c6f06)' }) },
  { id: 'c4-planet', slot: 'skin:connect4', name: 'Planètes', price: 40000, vars: (s) => ({ [`--c4-disc-${s}`]: s === 1 ? 'radial-gradient(circle at 30% 30%, #9be7ff, #2a6cd6 45%, #0b1e4f)' : 'radial-gradient(circle at 30% 30%, #ffd7a1, #d6612a 45%, #4f1a0b)' }) },
  // Skins : Morpion (symbole et couleur)
  { id: 'ttt-hearts', slot: 'skin:tictactoe', name: 'Cœurs', price: 10000, glyph: '♥', vars: (s) => ({ [`--ttt-color-${s}`]: '#e5484d' }) },
  { id: 'ttt-stars', slot: 'skin:tictactoe', name: 'Étoiles', price: 10000, glyph: '★', vars: (s) => ({ [`--ttt-color-${s}`]: '#f2b824' }) },
  { id: 'ttt-bolt', slot: 'skin:tictactoe', name: 'Éclairs', price: 25000, glyph: 'ϟ', vars: (s) => ({ [`--ttt-color-${s}`]: '#8b5cf6' }) },
  { id: 'ttt-crown', slot: 'skin:tictactoe', name: 'Couronnes', price: 60000, glyph: '♛', vars: (s) => ({ [`--ttt-color-${s}`]: '#d4a017' }) },
  // Skins : Échecs (pièces claires pour le joueur 1 = blancs, foncées pour le joueur 2 = noirs)
  { id: 'ch-ruby', slot: 'skin:chess', name: 'Rubis', price: 40000, vars: chessVars('#ffd6d6', '#9b111e', '#9b111e', '#ffb3b3') },
  { id: 'ch-ice', slot: 'skin:chess', name: 'Glace', price: 40000, vars: chessVars('#e8fbff', '#2a8fbd', '#1d5f86', '#bfefff') },
  { id: 'ch-neon', slot: 'skin:chess', name: 'Néon', price: 40000, vars: chessVars('#7cfff2', '#00a896', '#ff4fd8', '#5a0047') },
  { id: 'ch-gold', slot: 'skin:chess', name: 'Or massif', price: 60000, vars: chessVars('#ffe27a', '#8a6100', '#a87400', '#ffe9a3') },
  // Skins : Dames
  { id: 'dm-wood', slot: 'skin:checkers', name: 'Bois', price: 20000, vars: (s) => ({ [`--dm-bg-${s}`]: s === 1 ? 'radial-gradient(circle at 35% 30%, #f7e0b5, #d1a362 60%, #8a5a22)' : 'radial-gradient(circle at 35% 30%, #a0673a, #5b3216 60%, #2e1608)' }) },
  { id: 'dm-neon', slot: 'skin:checkers', name: 'Néon', price: 30000, vars: (s) => ({ [`--dm-bg-${s}`]: s === 1 ? 'radial-gradient(circle, #e8fffd 0 25%, #2bf3d0 60%, #067a66)' : 'radial-gradient(circle, #ffe8fb 0 25%, #ff2bd6 60%, #6d0a5d)' }) },
  { id: 'dm-gold', slot: 'skin:checkers', name: 'Or', price: 50000, vars: (s) => ({ [`--dm-bg-${s}`]: s === 1 ? 'radial-gradient(circle at 35% 30%, #fffbe0, #f1c232 50%, #9c6f06)' : 'radial-gradient(circle at 35% 30%, #ffe08a, #b07d08 50%, #4a3300)' }) },
  // Skins : Quoridor (pion)
  { id: 'qd-diamond', slot: 'skin:quoridor', name: 'Diamant', price: 30000, vars: (s) => ({ [`--qd-pawn-${s}`]: 'conic-gradient(from 45deg, #e0fbff, #7fd6ff, #ffffff, #9ad0ff, #e0fbff)' }) },
  { id: 'qd-ember', slot: 'skin:quoridor', name: 'Braise', price: 30000, vars: (s) => ({ [`--qd-pawn-${s}`]: 'radial-gradient(circle at 50% 60%, #fff3a0, #ff8c1a 45%, #b3200a)' }) },
  { id: 'qd-galaxy', slot: 'skin:quoridor', name: 'Galaxie', price: 60000, vars: (s) => ({ [`--qd-pawn-${s}`]: 'radial-gradient(circle at 30% 30%, #fff 0 4%, #c084fc 10%, #4c1d95 50%, #0b0623)' }) },
];

/**
 * Titres affichés à côté du pseudo. À compléter : un titre ajouté ici doit aussi être inséré dans
 * public.shop_items (slot 'title'). Tant qu'il est commenté ici et `active = false` côté serveur,
 * il n'apparaît pas dans la boutique et ne peut pas être acheté.
 */
export const TITLES: Item[] = [
  // { id: 'title-exemple-1', slot: 'title', name: 'Exemple 1', price: 100000 },
  // { id: 'title-exemple-2', slot: 'title', name: 'Exemple 2', price: 250000 },
];

const ALL = [...ITEMS, ...TITLES];
export const itemById = (id: string | null | undefined) => (id ? ALL.find((i) => i.id === id) : undefined);

export const SKIN_GAMES: [SkinGame, string][] = [
  ['connect4', 'Puissance 4'],
  ['tictactoe', 'Morpion'],
  ['chess', 'Échecs'],
  ['checkers', 'Dames'],
  ['quoridor', 'Quoridor'],
];

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

const MISSING = ['PGRST202', 'PGRST205', '42883', '42P01'];
const shopError = (err: { code?: string }) =>
  new Error(MISSING.includes(err.code ?? '') ? 'Boutique indisponible : migration 0008_boutique.sql à exécuter (voir le README).' : errorMessage(err));

/** Prix (serveur) des objets en vente, et ceux que je possède. */
export async function loadShop(): Promise<{ prices: Map<string, number>; owned: Set<string> }> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Serveur non configuré');
  const [items, inv] = await Promise.all([supabase.from('shop_items').select('id, price'), supabase.from('inventory').select('item_id')]);
  if (items.error) throw shopError(items.error);
  if (inv.error) throw shopError(inv.error);
  return {
    prices: new Map((items.data ?? []).map((r: { id: string; price: number }) => [r.id, Number(r.price)])),
    owned: new Set((inv.data ?? []).map((r: { item_id: string }) => r.item_id)),
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Serveur non configuré');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw shopError(error);
  return data as T;
}

export const buy = (item: string) => rpc<{ balance: number }>('shop_buy', { item });
export const equip = (slot: Slot, item: string | null) => rpc<void>('shop_equip', { slot, item });
