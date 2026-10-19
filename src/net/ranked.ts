import { load, remove, save } from '../core/storage';
import { ensureAccount, getAccount } from './auth';
import { errorMessage, getSupabase, multiConfigured } from './supabase';

// Parties solo classées : le serveur donne une graine, le client renvoie ses actions,
// le serveur rejoue la partie et calcule lui-même le score (voir les migrations SQL).

export type RankedGame = 'g2048' | 'tetris';

/** Nom du paramètre qui porte les actions dans la fonction SQL `<jeu>_finish`. */
const PAYLOAD_ARG: Record<RankedGame, string> = { g2048: 'moves', tetris: 'events' };

interface Pending {
  session: string;
  data: string;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await getSupabase();
  if (!supabase || !(await ensureAccount())) throw new Error('hors ligne');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(errorMessage(error));
  return data as T;
}

/** Démarre une partie classée. Retourne null si le serveur n'est pas configuré. Lève une erreur si indisponible. */
export async function startRanked(game: RankedGame): Promise<{ id: string; seed: number } | null> {
  if (!multiConfigured) return null;
  // Pas plus de 6 s d'attente : au-delà, on joue en non classé plutôt que de faire patienter.
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('serveur trop lent')), 6000));
  const r = await Promise.race([rpc<{ id: string; seed: number }>(`${game}_start`), timeout]);
  return { id: r.id, seed: Number(r.seed) };
}

/** Envoie une partie terminée. En cas d'échec réseau, elle est gardée et renvoyée plus tard. */
export async function submitRanked<T extends { score: number }>(
  game: RankedGame,
  session: string,
  data: string,
): Promise<T | { error: string }> {
  try {
    return await rpc<T>(`${game}_finish`, { session_id: session, [PAYLOAD_ARG[game]]: data });
  } catch (e) {
    const msg = (e as Error).message;
    // Refus du serveur (partie invalide, déjà envoyée…) : inutile de réessayer.
    if (!/fetch|réseau|network|hors ligne/i.test(msg)) return { error: msg };
    save(`pending:${game}`, [...load<Pending[]>(`pending:${game}`, []), { session, data }].slice(-20));
    return { error: 'hors ligne, envoi plus tard' };
  }
}

export async function flushPending(game: RankedGame): Promise<void> {
  const list = load<Pending[]>(`pending:${game}`, []);
  if (!list.length) return;
  remove(`pending:${game}`);
  for (const p of list) await submitRanked(game, p.session, p.data);
}

/** Message affiché après l'envoi d'un score. */
export function submitMessage(r: { score: number } | { error: string }): string {
  if ('error' in r) return `Score non enregistré : ${r.error}.`;
  if (getAccount()?.verified) return `Score de ${r.score} enregistré au classement.`;
  return `Score de ${r.score} enregistré. Ajoute un email (Réglages → Compte) pour apparaître au classement.`;
}
