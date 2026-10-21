// Horloge du serveur : l'heure de l'appareil peut être changée à la main (pour tricher sur les revenus
// de l'appart, par exemple), celle-ci non. On demande l'heure au serveur (public.server_now), puis on
// avance avec performance.now(), qui ne bouge pas quand on change l'heure de l'appareil.
// Les gains eux-mêmes sont toujours calculés par le serveur : ceci ne protège que l'affichage.

import { getSupabase, multiConfigured } from './supabase';

// Avant la première synchronisation : l'heure de l'appareil au chargement de la page, figée.
let base = Date.now();
let anchor = performance.now();
let synced: Promise<void> | null = null;

/** Heure actuelle (ms depuis 1970) d'après le serveur. */
export function serverNow(): number {
  return base + (performance.now() - anchor);
}

/** Synchronise l'horloge avec le serveur (une seule fois ; à nouveau si `force`). */
export function syncServerClock(force = false): Promise<void> {
  if (synced && !force) return synced;
  synced = (async () => {
    if (!multiConfigured) return;
    const supabase = await getSupabase();
    if (!supabase) return;
    const sent = performance.now();
    const { data, error } = await supabase.rpc('server_now');
    const received = performance.now();
    if (error || typeof data !== 'string') return; // migration absente : on garde l'heure du chargement
    // L'heure du serveur correspond au milieu de l'aller-retour.
    base = Date.parse(data) + (received - sent) / 2;
    anchor = received;
  })().catch(() => {});
  return synced;
}
