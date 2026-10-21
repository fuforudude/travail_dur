// Tower defense : envoi des vagues au serveur, dès qu'elles se terminent. La file est gardée dans le
// navigateur jusqu'à la confirmation du serveur : un rechargement, une page quittée ou une coupure
// réseau ne perdent rien (la file repart au retour). Le serveur reconnaît une vague déjà reçue
// (`step`), un renvoi ne compte donc jamais deux fois.

import { load, save } from '../../core/storage';
import { getSupabase, functionUrl, publicKey } from '../../net/supabase';
import { isFinalRefusal, sendWave, TD_PROTOCOL, type WaveResult } from './net';

interface Upload {
  session: string;
  step: number; // vagues déjà envoyées avant celle-ci
  actions: string;
}

export type UploadEvent =
  | { kind: 'sent'; session: string; step: number; result: WaveResult }
  | { kind: 'refused'; session: string; message: string } // définitif : la partie n'est plus suivie
  | { kind: 'waiting'; session: string; message: string }; // réseau, panne : on réessaie

const KEY = 'uploads:td';
const RETRY_MS = 5000;
let queue: Upload[] = load<Upload[]>(KEY, []);
let flushing = false;
let retry: number | undefined;
const listeners = new Set<(e: UploadEvent) => void>();

const store = () => save(KEY, queue);
const emit = (e: UploadEvent) => listeners.forEach((cb) => cb(e));

export function onUpload(cb: (e: UploadEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Ajoute une vague terminée à la file et l'envoie tout de suite. */
export function enqueue(u: Upload): void {
  queue.push(u);
  store();
  void flush();
}

/** Envoie la file, dans l'ordre. */
export async function flush(): Promise<void> {
  if (flushing || !queue.length) return;
  flushing = true;
  clearTimeout(retry);
  try {
    while (queue.length) {
      const u = queue[0];
      try {
        const result = await sendWave(u.session, u.actions, u.step);
        queue.shift();
        store();
        emit({ kind: 'sent', session: u.session, step: u.step, result });
      } catch (e) {
        const message = (e as Error).message;
        if (isFinalRefusal(e)) {
          // Le serveur ne veut plus de cette partie : on l'oublie, on passe aux suivantes.
          queue = queue.filter((o) => o.session !== u.session);
          store();
          emit({ kind: 'refused', session: u.session, message });
          continue;
        }
        emit({ kind: 'waiting', session: u.session, message });
        retry = window.setTimeout(() => void flush(), RETRY_MS);
        return;
      }
    }
  } finally {
    flushing = false;
  }
}

let started = false;
let token: string | null = null; // jeton de connexion, gardé pour l'envoi de dernière seconde

/** Lance l'envoi de la file et le relance tout seul (retour du réseau, onglet revenu). Une fois suffit. */
export function startUploads(): void {
  void flush();
  if (started) return;
  started = true;
  window.addEventListener('online', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void flush();
    else lastChance();
  });
  window.addEventListener('pagehide', lastChance);
  // Quitter la page pendant un envoi : le navigateur demande confirmation.
  window.addEventListener('beforeunload', (e) => {
    if (!queue.length) return;
    e.preventDefault();
    e.returnValue = '';
  });
  void refreshToken();
  window.setInterval(() => void refreshToken(), 5 * 60_000);
}

async function refreshToken(): Promise<void> {
  const supabase = await getSupabase();
  token = (await supabase?.auth.getSession())?.data.session?.access_token ?? null;
}

/**
 * Page cachée ou fermée avec une vague en attente : on l'envoie avec une requête qui survit à la
 * fermeture (keepalive). Seulement la première : les suivantes partiront au prochain passage (le
 * serveur ignore un doublon, la file reste donc valable même si celle-ci arrive).
 */
function lastChance(): void {
  const u = queue[0];
  const target = functionUrl('td');
  const apikey = publicKey();
  if (!u || !target || !apikey || !token) return;
  try {
    void fetch(target, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ op: 'wave', session: u.session, actions: u.actions, step: u.step, v: TD_PROTOCOL }),
    }).catch(() => {});
  } catch {
    // requête trop grosse pour keepalive (64 ko) : elle partira au prochain passage
  }
}
