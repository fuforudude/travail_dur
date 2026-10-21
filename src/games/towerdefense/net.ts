// Tower defense : échanges avec le serveur (fonction `td` pour les parties, tables et fonctions SQL
// de 0030_td_roguelike.sql, 0032_td_campagne.sql et 0033_td_etoiles.sql pour la progression, les
// étoiles, la boutique à étoiles, les héros, la collection et les caisses). Le serveur fait foi pour tout.

import { load, save } from '../../core/storage';
import { ensureAccount } from '../../net/auth';
import { errorMessage, getSupabase, multiConfigured } from '../../net/supabase';
import { skinOf, type Finish, type Rarity } from './catalog';
import { inChapter2, LEVEL_COUNT, PERK_MAX, perkCost, type Perks } from './engine/data';
import type { Mode, RunState } from './engine/sim';

export interface Meta {
  owned: Set<string>; // skins
  equipped: Map<string, string>; // emplacement (ts:<tour>, es:<ennemi>) → skin
  heroes: Map<string, number>; // héros → niveau
  cleared: number; // niveaux de la campagne terminés
  cleared2: number; // chapitre 2 : plus haut niveau réussi (26 à 75), 0 si aucun
  stars: Map<number, number>; // niveau → meilleures étoiles
  perks: Map<string, number>; // amélioration de la boutique à étoiles → rang
  best: number; // record du mode infini
  online: boolean;
}

export const emptyMeta = (): Meta => ({
  owned: new Set(), equipped: new Map(), heroes: new Map(), cleared: 0, cleared2: 0, stars: new Map(), perks: new Map(), best: 0, online: false,
});

/** Étoiles gagnées, dépensées et disponibles. */
export function starBalance(meta: Meta) {
  let earned = 0;
  for (const n of meta.stars.values()) earned += n;
  let spent = 0;
  for (const r of meta.perks.values()) for (let k = 1; k <= r; k++) spent += perkCost(k);
  return { earned, spent, left: earned - spent };
}

/** Plus haut niveau réussi du chapitre 2 (0 si aucun). */
const chapter2Max = (stars: [number, number][]) => Math.max(0, ...stars.map(([L]) => L).filter(inChapter2));

export const perksOf = (meta: Meta): Perks => Object.fromEntries(meta.perks);

const CACHE = 'meta:td3';
interface Cached {
  owned: string[];
  equipped: [string, string][];
  heroes: [string, number][];
  cleared: number;
  stars?: [number, number][];
  perks?: [string, number][];
  best: number;
}

const fromCache = (): Meta => {
  const c = load<Cached | null>(CACHE, null);
  return {
    owned: new Set(c?.owned ?? []), equipped: new Map(c?.equipped ?? []), heroes: new Map(c?.heroes ?? []),
    cleared: c?.cleared ?? 0, cleared2: chapter2Max(c?.stars ?? []), stars: new Map(c?.stars ?? []), perks: new Map(c?.perks ?? []), best: c?.best ?? 0, online: false,
  };
};
const toCache = (m: Meta) =>
  save(CACHE, {
    owned: [...m.owned], equipped: [...m.equipped], heroes: [...m.heroes], cleared: m.cleared, stars: [...m.stars], perks: [...m.perks], best: m.best,
  } satisfies Cached);

/** Hors ligne (pas de serveur) : la progression de la campagne reste sur cet appareil. */
export function saveLocalProgress(meta: Meta) {
  if (!meta.online) toCache(meta);
}

/** Note les étoiles d'un niveau réussi (si c'est mieux qu'avant). */
export function recordStars(meta: Meta, level: number, stars: number) {
  if (stars > (meta.stars.get(level) ?? 0)) meta.stars.set(level, stars);
  if (level <= LEVEL_COUNT && level > meta.cleared) meta.cleared = level;
  if (inChapter2(level) && level > meta.cleared2) meta.cleared2 = level;
  saveLocalProgress(meta);
}

async function client() {
  const supabase = await getSupabase();
  const account = await ensureAccount();
  if (!supabase || !account) throw new Error('hors ligne');
  return { supabase, uid: account.id };
}

/** Progression, héros, collection, skins portés et record. Hors ligne : dernière version connue. */
export async function loadMeta(): Promise<Meta> {
  if (!multiConfigured) return fromCache();
  try {
    const { supabase, uid } = await client();
    const sessions = () => supabase.from('td_sessions').select('wave, level').eq('user_id', uid).eq('rules', 3);
    const [items, equipped, heroes, won, perks, best] = await Promise.all([
      supabase.from('td_items').select('item_id').eq('user_id', uid),
      supabase.from('td_equipped').select('slot, item_id').eq('user_id', uid),
      supabase.from('td_heroes').select('hero_id, level').eq('user_id', uid),
      supabase.from('td_sessions').select('level, stars').eq('user_id', uid).eq('rules', 3).eq('mode', 'campaign').eq('won', true).limit(5000),
      supabase.from('td_perks').select('perk_id, rank').eq('user_id', uid),
      sessions().eq('mode', 'infinite').order('wave', { ascending: false }).limit(1),
    ]);
    const error = items.error ?? equipped.error ?? heroes.error ?? won.error ?? perks.error ?? best.error;
    if (error) throw new Error(errorMessage(error));
    const stars = new Map<number, number>();
    for (const r of won.data ?? []) {
      const L = Number(r.level);
      stars.set(L, Math.max(stars.get(L) ?? 0, Number(r.stars ?? 0), 1));
    }
    const meta: Meta = {
      owned: new Set((items.data ?? []).map((r) => String(r.item_id))),
      equipped: new Map((equipped.data ?? []).map((r) => [String(r.slot), String(r.item_id)])),
      heroes: new Map((heroes.data ?? []).map((r) => [String(r.hero_id), Number(r.level)])),
      cleared: Math.max(0, ...[...stars.keys()].filter((L) => L <= LEVEL_COUNT)),
      cleared2: chapter2Max([...stars]),
      stars,
      perks: new Map((perks.data ?? []).map((r) => [String(r.perk_id), Number(r.rank)])),
      best: Number(best.data?.[0]?.wave ?? 0),
      online: true,
    };
    toCache(meta);
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

/**
 * Version du protocole site ↔ fonction td. Le serveur refuse de démarrer une partie avec une version
 * plus ancienne (site resté ouvert sur un vieux code) et demande de recharger la page.
 */
export const TD_PROTOCOL = 2;

/** Erreur du serveur du tower defense ; `status` 400 = refus (définitif), sinon réseau ou panne (on réessaie). */
export class TdError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
/** Refus définitif : inutile de renvoyer. « Trop vite » se règle en attendant un peu. */
export const isFinalRefusal = (e: unknown) => e instanceof TdError && e.status === 400 && e.message !== 'vague jouée trop vite';

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { supabase } = await client();
  const { data, error } = await supabase.functions.invoke('td', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let msg = '';
    if (ctx && typeof ctx.json === 'function') msg = ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error ?? '';
    if (!msg && (ctx?.status === 404 || error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError')) msg = 'serveur du tower defense indisponible';
    throw new TdError(msg || error.message, ctx?.status ?? 0);
  }
  return data as T;
}

export async function startRun(mode: Mode, level: number, hero: string | null): Promise<{ id: string; state: RunState }> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('serveur trop lent')), 8000));
  return Promise.race([invoke<{ id: string; state: RunState }>({ op: 'start', mode, level, hero, v: TD_PROTOCOL }), timeout]);
}

/** La fonction serveur `td` répond-elle ? (non déployée : 404, rien n'est enregistré). */
export async function tdServerUp(): Promise<boolean> {
  if (!multiConfigured) return true; // hors ligne assumé : pas d'alerte
  try {
    await invoke<unknown>({ op: 'ping' });
    return true;
  } catch (e) {
    const msg = (e as Error).message;
    return msg !== 'serveur du tower defense indisponible' && msg !== 'hors ligne';
  }
}

export interface WaveResult {
  wave: number;
  lives: number;
  gold: number;
  kills: number;
  over: boolean;
  won: boolean;
  stars?: number;
  already?: boolean; // vague déjà reçue (renvoi après un rechargement)
}
/** Envoie une vague ; `step` = vagues déjà envoyées avant elle (le serveur ignore un doublon). */
export const sendWave = (session: string, actions: string, step: number) => invoke<WaveResult>({ op: 'wave', session, actions, step, v: TD_PROTOCOL });

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

export const openCrate = (crate: string) => rpc<{ item: string; rarity: Rarity | null; level?: number; balance: number }>('td_crate_open', { crate });
export const equipSkin = (slot: string, item: string | null) => rpc<null>('td_equip', { slot_id: slot, item });

// --- Boutique à étoiles ---------------------------------------------------------------------------

/** Achète le rang suivant d'une amélioration ; hors ligne, sur cet appareil seulement. */
export async function buyPerk(meta: Meta, perk: string): Promise<void> {
  const rank = meta.perks.get(perk) ?? 0;
  if (rank >= PERK_MAX) throw new Error('rang maximum');
  if (starBalance(meta).left < perkCost(rank + 1)) throw new Error('pas assez d’étoiles');
  if (meta.online) await rpc<{ rank: number }>('td_perk_buy', { perk });
  meta.perks.set(perk, rank + 1);
  saveLocalProgress(meta);
}

/** Rend toutes les étoiles dépensées. */
export async function resetPerks(meta: Meta): Promise<void> {
  if (meta.online) await rpc<unknown>('td_perk_reset', {});
  meta.perks.clear();
  saveLocalProgress(meta);
}
