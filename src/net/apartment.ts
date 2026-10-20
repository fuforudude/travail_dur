// Appartement, meubles et caisses (supabase/migrations/0009_appart_admin.sql).
// Le serveur fait foi pour les prix, les tirages et l'aménagement ; catalogue et géométrie : furniture.ts.

import { serverError, rpc } from './admin';
import { CAP_HOURS, type Layout, type Rarity } from './furniture';
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
      floor: layout.floor.map(({ o, x, y, r }) => (r ? { o, x, y, r } : { o, x, y })),
      wall: layout.wall.map(({ o, x, y, r, art }) => ({ o, x, y, ...(r ? { r } : {}), ...(art ? { art } : {}) })),
    },
  });
