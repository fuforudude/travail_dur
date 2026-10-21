// Appels à l'API du site (server/, hébergée sur le VPS) : le joueur est identifié par son jeton de
// connexion Supabase. L'adresse vient de VITE_API_URL ; sans elle, les domaines déjà passés sur l'API
// sont indisponibles (le reste du site continue de parler à Supabase directement).

import { getSupabase } from './supabase';

const base = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/+$/, '');

export const apiConfigured = Boolean(base);

/** Erreur renvoyée par l'API, avec son statut (403 : appart d'un non-ami, par exemple). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  if (!base) throw new ApiError(0, 'Serveur non configuré (VITE_API_URL).');
  const supabase = await getSupabase();
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new ApiError(401, 'non connecté');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: opts.keepalive,
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable : réessaie dans un instant.');
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `erreur ${res.status}`);
  return data as T;
}
