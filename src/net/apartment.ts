// Appartement, meubles et caisses. L'appart et les meubles passent par l'API (server/), qui décide
// de tout ; les caisses et les photos (admin) sont encore lues et tirées par Supabase directement.
// Catalogue, géométrie et calculs partagés avec le serveur : shared/furniture.ts.

import { serverError, rpc } from './admin';
import { api } from './api';
import { accrue, type Layout, type Rarity } from './furniture';
import { serverNow } from './serverClock';
import { getSupabase } from './supabase';

export * from './furniture';

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

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
  if (!supabase) throw new Error('Indisponible en mode local.');
  return supabase;
}

export interface ApartmentState {
  layout: Layout;
  rooms: string[]; // pièces débloquées, dans l'ordre d'achat
  specials: string[]; // équipements spéciaux achetés (SPECIALS)
  cleanStep: number;
  rate: number; // points par heure
  banked: number;
  lastTick: number; // ms, heure du serveur
}

/** Un appart tel que l'API le renvoie (server/src/appart/appart.service.ts) ; chez soi, avec ses meubles et photos. */
export interface AppartView {
  owner: { id: string; name: string };
  apartment: ApartmentState;
  artworks: Artwork[];
  furniture?: Owned[];
  photos?: number[];
  admin?: boolean;
}

/** L'appart de `owner` (« me » pour le sien). Erreur 403 (ApiError) si ce n'est pas un ami. */
export const loadAppart = (owner: string) => api<AppartView>('GET', `/appart/${owner}`);
export const loadApartment = async (uid: string) => (await loadAppart(uid)).apartment;

/** Revenus accumulés à l'instant t, pour le compteur (le serveur refait le calcul à chaque récolte). */
export const pending = (a: ApartmentState, t = serverNow()) => accrue(a.banked, a.rate, a.specials, t - a.lastTick);

type Changed<T = object> = { apartment: ApartmentState } & T;
export const cleanApartment = () => api<Changed<{ balance: number }>>('POST', '/appart/clean');
export const collectIncome = () => api<Changed<{ gain: number }>>('POST', '/appart/collect');
export const buyRoom = (room: string) => api<Changed<{ balance: number }>>('POST', '/appart/rooms', { room });
export const buySpecial = (special: string) => api<Changed<{ balance: number }>>('POST', '/appart/specials', { special });

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

export const sellFurniture = (owned: number) => api<{ price: number; balance: number }>('DELETE', `/furniture/${owned}`);
export const buyFurniture = (base: string) => api<{ balance: number; owned: Owned }>('POST', '/furniture', { base });
/** Résultat d'une caisse : un meuble, ou (caisse souvenirs) une photo débloquée. */
export type CrateResult =
  | { balance: number; owned: number; item: string; rarity: Rarity; photo?: undefined }
  | { balance: number; photo: Artwork; rarity: 'photo'; item?: undefined };
export const openCrate = (crate: string) => rpc<CrateResult>('crate_open', { crate });

/** Photos débloquées par ce joueur (caisse souvenirs). */
/** Enregistre l'aménagement (le serveur vérifie chaque meuble et renvoie l'appart à jour). */
export const saveLayout = (layout: Layout, opts: { keepalive?: boolean } = {}) =>
  api<Changed>(
    'PUT',
    '/appart/layout',
    {
      layout: Object.fromEntries(
        Object.entries(layout).map(([room, l]) => [
          room,
          {
            floor: l.floor.map(({ o, x, y, r, art }) => ({ o, x, y, ...(r ? { r } : {}), ...(art ? { art } : {}) })),
            wall: l.wall.map(({ o, x, y, r, art }) => ({ o, x, y, ...(r ? { r } : {}), ...(art ? { art } : {}) })),
          },
        ]),
      ),
    },
    opts,
  );
