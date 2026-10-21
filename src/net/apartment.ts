// Appartement, meubles et caisses (supabase/migrations/0009_appart_admin.sql).
// Le serveur fait foi pour les prix, les tirages et l'aménagement ; catalogue et géométrie : furniture.ts.

import { serverError, rpc } from './admin';
import { baseOf } from './furniture';
import { serverNow } from './serverClock';
import { capHours, type Layout, type Rarity } from './furniture';
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
  if (!supabase) throw new Error('Serveur non configuré');
  return supabase;
}

export interface ApartmentState {
  layout: Layout;
  rooms: string[]; // pièces débloquées, dans l'ordre d'achat
  specials: string[]; // équipements spéciaux achetés (SPECIALS)
  cleanStep: number;
  rate: number; // points par heure
  banked: number;
  lastTick: number; // ms
}

export async function loadApartment(uid: string): Promise<ApartmentState> {
  const { data, error } = await (await client())
    .from('apartments')
    .select('layout, rooms, specials, clean_step, rate, banked, last_tick')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw serverError(error);
  const rooms = (data?.rooms as string[] | undefined) ?? ['entree'];
  const l = (data?.layout as Partial<Layout> | undefined) ?? {};
  return {
    layout: Object.fromEntries(rooms.map((r) => [r, { floor: l[r]?.floor ?? [], wall: l[r]?.wall ?? [] }])),
    rooms,
    specials: (data?.specials as string[] | undefined) ?? [],
    cleanStep: Number(data?.clean_step ?? 0),
    rate: Number(data?.rate ?? 0),
    banked: Number(data?.banked ?? 0),
    lastTick: data?.last_tick ? Date.parse(data.last_tick as string) : serverNow(),
  };
}

/** Revenus accumulés à l'instant t (même calcul que public.apartment_settle), à l'heure du serveur. */
export function pending(a: ApartmentState, t = serverNow()): number {
  return Math.min(a.banked + (a.rate * (t - a.lastTick)) / 3_600_000, Math.max(a.rate, 1) * capHours(a.specials));
}

export const cleanApartment = () => rpc<{ balance: number; clean_step: number }>('apartment_clean');
export const collectIncome = () => rpc<{ gain: number }>('apartment_collect');
export const buyRoom = (room: string) => rpc<{ balance: number; rooms: string[] }>('apartment_room_buy', { room });
export const buySpecial = (special: string) => rpc<{ balance: number; specials: string[] }>('apartment_special_buy', { special });

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

/** Revente d'un meuble : 67 % du prix de base de son modèle (public.furniture_sell, 0038_vente_meubles.sql). */
export const sellPrice = (item: string) => Math.floor(((baseOf(item)?.price ?? 0) * 67) / 100);
export const sellFurniture = (owned: number) => rpc<{ price: number; balance: number }>('furniture_sell', { owned_id: owned });
export const buyFurniture = (base: string) => rpc<{ balance: number; owned: number; item: string }>('furniture_buy', { base_id: base });
/** Résultat d'une caisse : un meuble, ou (caisse souvenirs) une photo débloquée. */
export type CrateResult =
  | { balance: number; owned: number; item: string; rarity: Rarity; photo?: undefined }
  | { balance: number; photo: Artwork; rarity: 'photo'; item?: undefined };
export const openCrate = (crate: string) => rpc<CrateResult>('crate_open', { crate });

/** Photos débloquées par ce joueur (caisse souvenirs). */
export async function ownedPhotos(uid: string): Promise<Set<number>> {
  const { data, error } = await (await client()).from('artwork_owned').select('artwork_id').eq('user_id', uid);
  if (error) throw serverError(error);
  return new Set(((data as { artwork_id: number }[] | null) ?? []).map((r) => Number(r.artwork_id)));
}
export const saveLayout = (layout: Layout) =>
  rpc<Layout>('apartment_save', {
    layout: Object.fromEntries(
      Object.entries(layout).map(([room, l]) => [
        room,
        {
          floor: l.floor.map(({ o, x, y, r, art }) => ({ o, x, y, ...(r ? { r } : {}), ...(art ? { art } : {}) })),
          wall: l.wall.map(({ o, x, y, r, art }) => ({ o, x, y, ...(r ? { r } : {}), ...(art ? { art } : {}) })),
        },
      ]),
    ),
  });
