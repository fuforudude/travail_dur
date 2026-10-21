// Tower defense : enregistrement des parties sur le serveur, sans jamais faire attendre le joueur.
//
// * Lancement : chaque partie démarre sur un ticket réservé d'avance (partie réservée sur le
//   serveur, graine tirée par lui). Pas d'appel réseau au moment de jouer, même serveur lent ou
//   coupé ; un nouveau ticket est réservé en arrière-plan pour la partie suivante.
// * File : le démarrage d'une partie (avec ses réglages), puis chacune de ses vagues terminées,
//   entrent dans une file gardée dans le navigateur jusqu'à la confirmation du serveur. Elle part
//   par lots, dans l'ordre, dès que possible ; un rechargement, une page quittée ou une coupure ne
//   perdent rien : elle repart à la prochaine visite (depuis n'importe quelle page, voir main.ts) et
//   un dernier envoi part à la fermeture de la page (keepalive).
// * Le serveur reconnaît un envoi déjà reçu (ticket déjà démarré, `step` de la vague) : un renvoi ne
//   compte jamais deux fois. Seul un refus définitif (partie invalide) retire une partie de la file.
// * Plusieurs onglets : la file est relue dans le stockage avant chaque modification (jamais de
//   copie qui écraserait les ajouts d'un autre onglet) et un seul onglet l'envoie à la fois.
// * Tant qu'un résultat attend dans la file, la progression affichée en tient compte
//   (`withPending`) : une victoire ne « disparaît » pas parce que le serveur ne l'a pas encore reçue.

import { load, remove, save } from '../../core/storage';
import { functionUrl, multiConfigured, publicKey, getSupabase } from '../../net/supabase';
import type { RunOptions } from './engine/sim';
import { currentUid, knownUid, recordStars, reserveTicket, syncItems, TD_PROTOCOL, type Meta, type SyncItem, type WaveResult } from './net';

/** Ce que le site sait de la partie après cette vague (affichage en attendant le serveur). */
interface Outcome {
  mode: 'campaign' | 'infinite';
  level: number;
  wave: number;
  won: boolean;
  stars: number;
}

type Upload =
  | { kind?: 'wave'; session: string; step: number; actions: string; outcome?: Outcome } // step : vagues envoyées avant celle-ci
  | { kind: 'start'; session: string; options: RunOptions };

export type UploadEvent =
  | { kind: 'sent'; session: string; result?: WaveResult }
  | { kind: 'refused'; session: string; message: string } // définitif : la partie n'est plus suivie
  | { kind: 'waiting'; message: string }; // réseau, panne : on réessaie tout seul

const KEY = 'uploads:td';
const BATCH = 40;
const KEEPALIVE_BYTES = 60_000; // limite des requêtes keepalive : 64 ko
let memory: Upload[] = []; // stockage indisponible (navigation privée stricte) : la file vit ici
let flushing = false;
let retry: number | undefined;
let delay = 0; // attente avant le prochain essai, qui s'allonge tant que le serveur ne répond pas
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
const toSync = (u: Upload): SyncItem =>
  u.kind === 'start' ? { kind: 'start', session: u.session, options: u.options } : { kind: 'wave', session: u.session, step: u.step, actions: u.actions };
const emit = (e: UploadEvent) => listeners.forEach((cb) => cb(e));

export function onUpload(cb: (e: UploadEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Envois de cette partie (ou de toutes) pas encore confirmés par le serveur. */
export const pendingFor = (session?: string | null) => (session === null ? 0 : read().filter((u) => session === undefined || u.session === session).length);

/** Ajoute un démarrage ou une vague terminée à la file et l'envoie tout de suite. */
export function enqueue(u: Upload): void {
  const q = read();
  if (!q.some((o) => same(o, u))) q.push(u);
  write(q);
  delay = 0;
  void flush();
}

/** Progression connue du serveur + résultats encore dans la file (niveaux réussis, record). */
export function withPending(meta: Meta): Meta {
  for (const u of read()) {
    const o = u.kind !== 'start' ? u.outcome : undefined;
    if (!o) continue;
    if (o.mode === 'campaign' && o.won) recordStars(meta, o.level, o.stars);
    if (o.mode === 'infinite') meta.best = Math.max(meta.best, o.wave);
  }
  return meta;
}

// --- Envoi ------------------------------------------------------------------------------------------

/** Envoie la file, dans l'ordre, par lots, depuis un seul onglet à la fois. */
export async function flush(): Promise<void> {
  if (flushing || !multiConfigured || !read().length) return;
  flushing = true;
  clearTimeout(retry);
  try {
    if (navigator.locks) await navigator.locks.request('td-uploads', { ifAvailable: true }, (lock) => (lock ? drain() : undefined));
    else await drain();
  } finally {
    flushing = false;
  }
}

function later(message: string): void {
  emit({ kind: 'waiting', message });
  delay = Math.min(30_000, delay ? delay * 2 : 2000);
  clearTimeout(retry);
  retry = window.setTimeout(() => void flush(), delay);
}

async function drain(): Promise<void> {
  for (;;) {
    const batch = read().slice(0, BATCH);
    if (!batch.length) return;
    let results;
    try {
      ({ results } = await syncItems(batch.map(toSync)));
    } catch (e) {
      // Réseau, panne, serveur pas encore à jour… : rien n'est retiré, on réessaie plus tard.
      return later((e as Error).message);
    }
    const done: Upload[] = [];
    const refused = new Map<string, string>();
    let stopped = '';
    batch.forEach((u, i) => {
      const r = results[i];
      if (!r) return;
      if (r.ok) {
        done.push(u);
        emit({ kind: 'sent', session: u.session, result: r.result });
      } else if (r.final) refused.set(u.session, r.error);
      else stopped ||= r.error;
    });
    write(read().filter((o) => !done.some((d) => same(d, o)) && !refused.has(o.session)));
    for (const [session, message] of refused) {
      console.warn(`Tower defense : partie ${session} refusée par le serveur (${message})`);
      emit({ kind: 'refused', session, message });
    }
    delay = 0;
    if (stopped || results.length < batch.length) return later(stopped || 'serveur occupé');
  }
}

// --- Tickets ----------------------------------------------------------------------------------------

interface Ticket {
  id: string;
  seed: number;
  uid: string; // compte qui l'a réservé : un autre compte ne peut pas s'en servir
}
const TICKET_KEY = 'ticket:td';
let reserving: Promise<Ticket | null> | null = null;

/** Tickets que ce navigateur garde ou attend de démarrer (le serveur en donne un autre). */
const held = () => read().flatMap((u) => (u.kind === 'start' ? [u.session] : []));

/** Garde un ticket d'avance (au chargement du jeu, après chaque lancement). Sans effet s'il y en a un. */
export function keepTicket(timeoutMs?: number): Promise<Ticket | null> {
  if (!multiConfigured) return Promise.resolve(null);
  reserving ??= (async () => {
    try {
      const uid = await currentUid();
      const kept = load<Ticket | null>(TICKET_KEY, null);
      if (kept?.uid === uid) return kept;
      const t = await reserveTicket(held(), timeoutMs);
      const ticket = { id: t.id, seed: t.seed, uid };
      save(TICKET_KEY, ticket);
      return ticket;
    } catch {
      return null; // hors ligne ou serveur lent : on réessaiera au prochain lancement
    } finally {
      reserving = null;
    }
  })();
  return reserving;
}

/** Prend le ticket gardé pour lancer une partie (il ne sert qu'une fois) et en réserve un autre. */
export function takeTicket(): Ticket | null {
  const t = load<Ticket | null>(TICKET_KEY, null);
  const uid = knownUid();
  if (!t || (uid && t.uid !== uid)) return null;
  remove(TICKET_KEY);
  window.setTimeout(() => void keepTicket(), 1000);
  return t;
}

// --- Démarrage, fermeture de page ------------------------------------------------------------------

let started = false;
let token: string | null = null; // jeton de connexion, gardé pour l'envoi de dernière seconde

/** Lance l'envoi de la file et le relance tout seul (retour du réseau, onglet revenu). Une fois suffit. */
export function startUploads(): void {
  void flush();
  if (started) return;
  started = true;
  window.addEventListener('online', () => {
    delay = 0;
    void flush();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void flush();
    else lastChance();
  });
  window.addEventListener('pagehide', lastChance);
  // Un autre onglet a ajouté un envoi, ou s'est fermé en laissant la file : on prend le relais.
  window.addEventListener('storage', (e) => {
    if (e.key?.endsWith(KEY)) void flush();
  });
  void refreshToken();
  window.setInterval(() => void refreshToken(), 5 * 60_000);
}

async function refreshToken(): Promise<void> {
  const supabase = await getSupabase();
  token = (await supabase?.auth.getSession())?.data.session?.access_token ?? null;
}

/**
 * Page cachée ou fermée avec des envois en attente : on envoie la file (autant qu'en tient une
 * requête keepalive) avec une requête qui survit à la fermeture. Le serveur reconnaît un doublon,
 * même si l'envoi normal est en route au même moment : la file reste valable et repartira.
 */
function lastChance(): void {
  const target = functionUrl('td');
  const apikey = publicKey();
  const q = read();
  if (!q.length || !target || !apikey || !token || !navigator.onLine) return;
  const items: SyncItem[] = [];
  let body = '';
  for (const u of q.slice(0, BATCH)) {
    const next = JSON.stringify({ op: 'sync', items: [...items, toSync(u)], v: TD_PROTOCOL });
    if (next.length > KEEPALIVE_BYTES) break;
    items.push(toSync(u));
    body = next;
  }
  if (!body) return;
  try {
    void fetch(target, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey, Authorization: `Bearer ${token}` },
      body,
    }).catch(() => {});
  } catch {
    // keepalive refusé par le navigateur : la file partira à la prochaine visite
  }
}

