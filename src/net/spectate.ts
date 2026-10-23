// Regarder un ami jouer au casino (supabase/migrations/0049_spectateur.sql) : chaque tour joué est
// noté par le serveur dans casino_spins, lisible par le joueur et ses amis, et suivi en direct.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { errorMessage, getSupabase } from './supabase';

export interface Spin {
  id: number;
  game: 'roulette' | 'slots';
  detail: { number?: number; bets?: Record<string, number>; reels?: number[] };
  stake: number;
  payout: number;
  balance: number;
  created_at: string;
}

const COLUMNS = 'id, game, detail, stake, payout, balance, created_at';
const MISSING = ['PGRST202', 'PGRST205', '42883', '42P01'];

const toSpin = (s: Spin): Spin => ({ ...s, stake: Number(s.stake), payout: Number(s.payout), balance: Number(s.balance) });

/** Derniers tours de ce joueur (la dernière heure au plus), du plus récent au plus ancien. */
export async function recentSpins(uid: string, limit = 10): Promise<Spin[]> {
  const supabase = await getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.from('casino_spins').select(COLUMNS).eq('user_id', uid).order('id', { ascending: false }).limit(limit);
  if (error) throw new Error(MISSING.includes(error.code ?? '') ? 'Serveur pas à jour : migration 0049_spectateur.sql à exécuter.' : errorMessage(error));
  return ((data as Spin[] | null) ?? []).map(toSpin);
}

/** Chaque nouveau tour de ce joueur, en direct. Retourne la fonction qui arrête le suivi. */
export function watchSpins(uid: string, cb: (s: Spin) => void): () => void {
  let channel: RealtimeChannel | null = null;
  let stopped = false;
  void getSupabase().then((supabase) => {
    if (!supabase || stopped) return;
    channel = supabase
      .channel(`spectate:${uid}:${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'casino_spins', filter: `user_id=eq.${uid}` }, (p) => cb(toSpin(p.new as Spin)))
      .subscribe();
  });
  return () => {
    stopped = true;
    if (channel) void getSupabase().then((supabase) => supabase && channel && void supabase.removeChannel(channel));
  };
}

export async function playerName(uid: string): Promise<string> {
  const supabase = await getSupabase();
  const { data } = (await supabase?.from('profiles').select('username').eq('id', uid).maybeSingle()) ?? {};
  return (data as { username: string } | null)?.username ?? 'Joueur';
}
