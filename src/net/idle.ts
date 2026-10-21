// Revenus de l'appart en idle : récoltés chaque minute, quelle que soit la page ouverte
// (public.apartment_collect regroupe les récoltes d'une heure en une seule ligne d'historique).
// Hors du site, ils s'accumulent côté serveur (24 h au plus) et tombent au retour.

import { refreshWallet } from './points';

const EVERY = 60_000;
let who = '';
let timer: number | undefined;
let tick: () => Promise<void> = async () => {};
const listeners = new Set<(gain: number) => void>();

/** Après chaque récolte automatique (la page de l'appart recharge alors ses compteurs). */
export function onIdleIncome(cb: (gain: number) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function startIdleIncome(me: string): void {
  if (me === who) return;
  const first = !who;
  who = me;
  clearInterval(timer);
  tick = async () => {
    if (document.hidden) return; // onglet en arrière-plan : rien ne se perd, on récolte au retour
    try {
      const { collectIncome } = await import('./apartment');
      const { gain } = await collectIncome();
      if (who !== me || gain <= 0) return;
      void refreshWallet();
      listeners.forEach((cb) => cb(gain));
    } catch {
      // hors ligne, serveur pas à jour… : on réessaiera à la prochaine minute
    }
  };
  window.setTimeout(() => void tick(), 4000);
  timer = window.setInterval(() => void tick(), EVERY);
  if (first) document.addEventListener('visibilitychange', () => !document.hidden && void tick());
}
