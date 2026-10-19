import type { SupabaseClient } from '@supabase/supabase-js';

// Tolère l'URL copiée depuis « Data API » (…/rest/v1/) : le client attend l'URL racine du projet.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/(rest\/v1\/?)?$/, '').replace(/\/+$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const multiConfigured = Boolean(url && key);

let client: Promise<SupabaseClient | null> | null = null;

/**
 * Client Supabase, ou null si non configuré. Chargé à la demande pour que le solo
 * n'attende pas la librairie au démarrage.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!multiConfigured) return Promise.resolve(null);
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url!, key!, {
      // Flux implicite : le lien reçu par email marche aussi s'il est ouvert sur un autre appareil.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    }),
  );
  return client;
}

/** Message lisible à partir d'une erreur Supabase / Postgres. */
export function errorMessage(err: unknown): string {
  const e = err as { message?: string; code?: string } | null;
  if (!e) return 'Erreur inconnue';
  if (e.code === '23505') return 'Ce pseudo est déjà pris.';
  if (e.code === '23514') return 'Pseudo invalide : 2 à 16 caractères, lettres, chiffres, _ ou -.';
  return e.message ?? String(err);
}
