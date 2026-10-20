// Tower defense : échanges avec le serveur (fonction `td` pour les parties, tables et fonctions SQL
// de 0030_td_roguelike.sql pour la collection et les caisses). Le serveur fait foi pour tout.

import { load, save } from '../../core/storage';
import { ensureAccount } from '../../net/auth';
import { errorMessage, getSupabase, multiConfigured } from '../../net/supabase';
import { skinOf, type Finish, type Rarity } from './catalog';
import type { RunState } from './engine/sim';

export interface Meta {
  owned: Set<string>;
  equipped: Map<string, string>; // emplacement (ts:<tour>, es:<ennemi>) → skin
  best: number;
  online: boolean;
}

const CACHE = 'meta:td';
interface Cached {
  owned: string[];
  equipped: [string, string][];
  best: number;
}

const fromCache = (): Meta => {
  const c = load<Cached | null>(CACHE, null);
  return { owned: new Set(c?.owned ?? []), equipped: new Map(c?.equipped ?? []), best: c?.best ?? 0, online: false };
};

async function client() {
  const supabase = await getSupabase();
  const account = await ensureAccount();
  if (!supabase || !account) throw new Error('hors ligne');
  return { supabase, uid: account.id };
}

/** Collection, skins portés et record. Hors ligne : dernière version connue. */
export async function loadMeta(): Promise<Meta> {
  if (!multiConfigured) return fromCache();
  try {
    const { supabase, uid } = await client();
    const [items, equipped, best] = await Promise.all([
      supabase.from('td_items').select('item_id').eq('user_id', uid),
      supabase.from('td_equipped').select('slot, item_id').eq('user_id', uid),
      supabase.from('td_sessions').select('wave').eq('user_id', uid).eq('rules', 2).order('wave', { ascending: false }).limit(1),
    ]);
    const error = items.error ?? equipped.error ?? best.error;
    if (error) throw new Error(errorMessage(error));
    const meta: Meta = {
      owned: new Set((items.data ?? []).map((r) => String(r.item_id))),
      equipped: new Map((equipped.data ?? []).map((r) => [String(r.slot), String(r.item_id)])),
      best: Number(best.data?.[0]?.wave ?? 0),
      online: true,
    };
    save(CACHE, { owned: [...meta.owned], equipped: [...meta.equipped], best: meta.best } satisfies Cached);
    return meta;
  } catch {
    return fromCache();
  }
}

/** Finition portée par une tour (`ts`) ou un ennemi (`es`). */
export function equippedFinish(meta: Meta, kind: 'ts' | 'es', subject: string): Finish | null {
  const item = meta.equipped.get(`${kind}:${subject}`);
  return item ? skinOf(item)?.finish ?? null : null;
}

// --- Parties ------------------------------------------------------------------------------------

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { supabase } = await client();
  const { data, error } = await supabase.functions.invoke('td', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let msg = '';
    if (ctx && typeof ctx.json === 'function') msg = ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error ?? '';
    if (!msg && (ctx?.status === 404 || error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError')) msg = 'serveur du tower defense indisponible';
    throw new Error(msg || error.message);
  }
  return data as T;
}

export async function startRun(deck: string[]): Promise<{ id: string; state: RunState }> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('serveur trop lent')), 8000));
  return Promise.race([invoke<{ id: string; state: RunState }>({ op: 'start', deck }), timeout]);
}

export interface WaveResult {
  wave: number;
  lives: number;
  gold: number;
  kills: number;
  over: boolean;
}
export const sendWave = (session: string, actions: string) => invoke<WaveResult>({ op: 'wave', session, actions });

// --- Caisses ------------------------------------------------------------------------------------

export interface CrateInfo {
  id: string;
  price: number;
  minWave: number;
  odds: [Rarity, number][];
}

export async function crateInfo(): Promise<Map<string, CrateInfo>> {
  const { supabase } = await client();
  const [crates, odds] = await Promise.all([
    supabase.from('td_crates').select('id, price, min_wave').eq('active', true),
    supabase.from('td_crate_odds').select('crate_id, rarity, weight'),
  ]);
  const error = crates.error ?? odds.error;
  if (error) throw new Error(errorMessage(error));
  const out = new Map<string, CrateInfo>();
  for (const c of crates.data ?? []) out.set(String(c.id), { id: String(c.id), price: Number(c.price), minWave: Number(c.min_wave), odds: [] });
  for (const o of odds.data ?? []) out.get(String(o.crate_id))?.odds.push([o.rarity as Rarity, Number(o.weight)]);
  for (const c of out.values()) c.odds.sort((a, b) => b[1] - a[1]);
  return out;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { supabase } = await client();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errorMessage(error));
  return data as T;
}

export const openCrate = (crate: string) => rpc<{ item: string; rarity: Rarity | null; balance: number }>('td_crate_open', { crate });
export const equipSkin = (slot: string, item: string | null) => rpc<null>('td_equip', { slot_id: slot, item });
