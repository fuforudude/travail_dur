import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const multiConfigured = Boolean(url && key);

let client: Promise<SupabaseClient | null> | null = null;

/**
 * Client Supabase, ou null si non configuré. Chargé à la demande pour que le solo
 * n'embarque pas la librairie au démarrage.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!multiConfigured) return Promise.resolve(null);
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
  return client;
}
