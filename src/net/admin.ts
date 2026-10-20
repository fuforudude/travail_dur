// Administration (supabase/migrations/0009_appart_admin.sql) : tout est vérifié par le serveur,
// ce module ne fait qu'appeler ses fonctions. Être admin côté client ne donne aucun droit.

import { ensureAccount } from './auth';
import { errorMessage, getSupabase, multiConfigured } from './supabase';

let adminCheck: Promise<boolean> | null = null;
let adminFor = '';
let known = false;

/** Dernière réponse connue de isAdmin(), sans attendre (pour le menu). */
export const adminKnown = () => known;

/** Le compte connecté est-il admin ? (Sert seulement à afficher ou non les pages réservées.) */
export function isAdmin(): Promise<boolean> {
  if (!multiConfigured) return Promise.resolve(false);
  return ensureAccount().then((a) => {
    if (!a) return false;
    if (adminCheck && adminFor === a.id) return adminCheck;
    adminFor = a.id;
    adminCheck = getSupabase().then(async (supabase) => {
      const { data } = (await supabase?.from('admins').select('user_id').eq('user_id', a.id).maybeSingle()) ?? {};
      known = Boolean(data);
      return known;
    });
    return adminCheck;
  });
}

const MISSING = ['PGRST202', 'PGRST205', '42883', '42P01'];
export const serverError = (err: { code?: string }) =>
  new Error(MISSING.includes(err.code ?? '') ? 'Serveur pas à jour : migration 0009_appart_admin.sql à exécuter (voir le README).' : errorMessage(err));

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Serveur non configuré');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw serverError(error);
  return data as T;
}

export interface PlayerRow {
  id: string;
  username: string;
  verified: boolean;
  balance: number;
  earned: number;
  cursed: boolean;
  curse_level: number;
  is_admin: boolean;
}

export const findPlayers = (search: string) => rpc<PlayerRow[]>('admin_find_players', { search });
export const givePoints = (target: string, amount: number, reason: string) => rpc<number>('admin_points', { target, amount, reason });
export const renamePlayer = (target: string, name: string) => rpc<void>('admin_rename', { target, name });
export const setCurse = (target: string, enabled: boolean, lvl: number) => rpc<void>('admin_curse', { target, enabled, lvl });
export const scareNow = (target: string) => rpc<void>('admin_scare', { target });
export const giveItem = (target: string, item: string) => rpc<void>('admin_give', { target, item });

/** Envoie une photo dans le stockage « artworks » puis l'ajoute à la liste des photos à accrocher. */
export async function addArtwork(file: File, title: string): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Serveur non configuré');
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await supabase.storage.from('artworks').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) throw new Error(`Envoi impossible : ${up.error.message}`);
  const url = supabase.storage.from('artworks').getPublicUrl(path).data.publicUrl;
  try {
    await rpc('admin_artwork_add', { title, url, path });
  } catch (e) {
    await supabase.storage.from('artworks').remove([path]);
    throw e;
  }
}

export async function deleteArtwork(id: number): Promise<void> {
  const path = await rpc<string | null>('admin_artwork_delete', { artwork: id });
  const supabase = await getSupabase();
  if (path) await supabase?.storage.from('artworks').remove([path]);
}

export interface LogRow {
  id: number;
  action: string;
  target: string | null;
  detail: string | null;
  created_at: string;
}

export async function adminLog(): Promise<LogRow[]> {
  const supabase = await getSupabase();
  const { data, error } = (await supabase?.from('admin_log').select('id, action, target, detail, created_at').order('id', { ascending: false }).limit(30)) ?? {};
  if (error) throw serverError(error);
  return (data as LogRow[] | null) ?? [];
}
