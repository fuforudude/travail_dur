// Tower defense : envoi des vagues au serveur, dès qu'elles se terminent. La file est gardée dans le
// navigateur jusqu'à la confirmation du serveur : un rechargement, une page quittée ou une coupure
// réseau ne perdent rien (la file repart au retour). Le serveur reconnaît une vague déjà reçue
// (`step`), un renvoi ne compte donc jamais deux fois.

import { load, save } from '../../core/storage';
import { isFinalRefusal, sendWave, type WaveResult } from './net';

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

/** Vagues de cette partie pas encore confirmées par le serveur. */
export const pendingFor = (session: string | null) => (session ? queue.filter((u) => u.session === session).length : 0);

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
          console.warn('Tower defense : vague refusée par le serveur', message);
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

// Quitter la page pendant un envoi : le navigateur demande confirmation (la file repartira de
// toute façon au prochain passage sur le tower defense).
window.addEventListener('beforeunload', (e) => {
  if (!queue.length) return;
  e.preventDefault();
  e.returnValue = '';
});
