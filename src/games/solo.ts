// Parties solo contre l'ordinateur : jouées entièrement dans le navigateur, elles rapportent un
// petit gain (public.points_solo, 0034_gains.sql), limité côté serveur (une partie toutes les 20 s,
// 30 par jour) puisque le résultat n'y est pas vérifié.

import { getSupabase, multiConfigured } from '../net/supabase';

/** Une partie solo vient de se terminer : `won` si le joueur a gagné. */
export function soloReward(game: string, won: boolean, moves: number): void {
  if (!multiConfigured || moves < 4) return; // partie bâclée : rien
  void getSupabase()
    .then((supabase) => supabase?.rpc('points_solo', { game, won }))
    .catch(() => {
      // hors ligne ou migration absente : la partie reste gratuite
    });
}
