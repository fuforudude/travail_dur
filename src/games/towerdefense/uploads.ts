// Tower defense : envoi des parties au serveur. Tout passe par une file gardée dans le navigateur
// jusqu'à la confirmation du serveur : un rechargement, une page quittée ou une coupure réseau ne
// perdent rien (la file repart au retour). Une partie lancée hors ligne y entre aussi : d'abord son
// démarrage (ticket réservé d'avance, voir net.ts), puis ses vagues. Le serveur reconnaît un envoi
// déjà reçu (`step`, ticket déjà démarré) : un renvoi ne compte jamais deux fois.
//
// Plusieurs onglets peuvent être ouverts : la file est relue dans le stockage avant chaque
// modification (jamais de copie qui écraserait les ajouts d'un autre onglet) et un seul onglet
// l'envoie à la fois (verrou du navigateur).

import { load, save } from '../../core/storage';
import { getSupabase, functionUrl, publicKey } from '../../net/supabase';
import { isFinalRefusal, sendStart, sendWave, TD_PROTOCOL, type WaveResult } from './net';
import type { RunOptions } from './engine/sim';

type Upload =
  | { kind?: 'wave'; session: string; step: number; actions: string } // step : vagues envoyées avant celle-ci
  | { kind: 'start'; session: string; options: RunOptions }; // partie lancée hors ligne (ticket)

export type UploadEvent =
  | { kind: 'sent'; session: string; result?: WaveResult }
  | { kind: 'refused'; session: string; message: string } // définitif : la partie n'est plus suivie
  | { kind: 'waiting'; session: string; message: string }; // réseau, panne : on réessaie

const KEY = 'uploads:td';
const RETRY_MS = 5000;
let memory: Upload[] = []; // stockage indisponible (navigation privée stricte) : la file vit ici
let flushing = false;
let retry: number | undefined;
const listeners = new Set<(e: UploadEvent) => void>();

const read = (): Upload[] => load<Upload[] | null>(KEY, null) ?? memory;
const write = (q: Upload[]) => {
  memory = q;
  save(KEY, q);
};
const same = (a: Upload, b: Upload) => {
  if (a.session !== b.session) return false;
  if (a.kind === 'start' || b.kind === 'start') return a.kind === b.kind;
  return a.step === b.step;
};
const emit = (e: UploadEvent) => listeners.forEach((cb) => cb(e));

export function onUpload(cb: (e: UploadEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Envois de cette partie pas encore confirmés : vagues, et démarrage d'une partie lancée hors ligne. */
export function pendingFor(session: string | null): { waves: number; start: boolean } {
  const mine = session ? read().filter((u) => u.session === session) : [];
  return { waves: mine.filter((u) => u.kind !== 'start').length, start: mine.some((u) => u.kind === 'start') };
}

/** Ajoute un envoi (démarrage hors ligne ou vague terminée) à la file et l'envoie tout de suite. */
export function enqueue(u: Upload): void {
  const q = read();
  if (!q.some((o) => same(o, u))) q.push(u);
  write(q);
  void flush();
}

/** Envoie la file, dans l'ordre, depuis un seul onglet à la fois. */
export async function flush(): Promise<void> {
  if (flushing || !read().length) return;
  flushing = true;
  clearTimeout(retry);
  try {
    if (navigator.locks) await navigator.locks.request('td-uploads', { ifAvailable: true }, (lock) => (lock ? drain() : undefined));
    else await drain();
  } finally {
    flushing = false;
  }
}

async function drain(): Promise<void> {
  for (let u = read()[0]; u; u = read()[0]) {
    try {
      let result: WaveResult | undefined;
      if (u.kind === 'start') await sendStart(u.session, u.options);
      else result = await sendWave(u.session, u.actions, u.step);
      write(read().filter((o) => !same(o, u)));
      emit({ kind: 'sent', session: u.session, result });
    } catch (e) {
      const message = (e as Error).message;
      if (isFinalRefusal(e)) {
        // Le serveur ne veut plus de cette partie : on l'oublie, on passe aux suivantes.
        console.warn(`Tower defense : partie ${u.session} refusée par le serveur (${message})`);
        write(read().filter((o) => o.session !== u.session));
        emit({ kind: 'refused', session: u.session, message });
        continue;
      }
      emit({ kind: 'waiting', session: u.session, message });
      retry = window.setTimeout(() => void flush(), RETRY_MS);
      return;
    }
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
  // Un autre onglet a ajouté un envoi, ou s'est fermé en laissant la file : on prend le relais.
  window.addEventListener('storage', (e) => {
    if (e.key?.endsWith(KEY)) void flush();
  });
  // Quitter la page pendant un envoi : le navigateur demande confirmation. Hors ligne, inutile : la
  // file est gardée et partira à la prochaine visite.
  window.addEventListener('beforeunload', (e) => {
    if (!read().length || !navigator.onLine) return;
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
 * Page cachée ou fermée avec un envoi en attente : on envoie le premier avec une requête qui survit
 * à la fermeture (keepalive). Seulement lui : les suivants partiront au prochain passage. Le serveur
 * reconnaît un doublon (même si l'envoi normal est en route au même moment), la file reste valable.
 */
function lastChance(): void {
  const u = read()[0];
  const target = functionUrl('td');
  const apikey = publicKey();
  if (!u || !target || !apikey || !token || !navigator.onLine) return;
  const body =
    u.kind === 'start'
      ? { op: 'start', ticket: u.session, options: u.options, v: TD_PROTOCOL }
      : { op: 'wave', session: u.session, actions: u.actions, step: u.step, v: TD_PROTOCOL };
  try {
    void fetch(target, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    // requête trop grosse pour keepalive (64 ko) : elle partira au prochain passage
  }
}
