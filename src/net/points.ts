// Points : le solde vient du serveur (public.wallets), qui attribue lui-même les gains à la fin des
// parties et fait les tirages du casino (supabase/migrations/0007_points_casino.sql).

import type { RealtimeChannel } from '@supabase/supabase-js';
import { errorMessage, getSupabase, multiConfigured } from './supabase';

export interface Wallet {
  balance: number;
  earned: number;
}

export interface PointEvent {
  id: number;
  amount: number;
  reason: string;
  kind: 'game' | 'record' | 'bonus' | 'casino';
  created_at: string;
}

/** Barème affiché dans la page Points : doit rester identique aux fonctions points_* du serveur. */
export const SCALE: [string, string][] = [
  ['2048', '√score, + 30 / 150 / 400 pour les tuiles 1024 / 2048 / 4096'],
  ['Tetris', '√score (10 000 points : 100)'],
  ['Flappy Bird', 'tuyaux^1,5 ÷ 4 (10 tuyaux : 7 · 40 : 63 · 80 : 178)'],
  ['Tower defense', '2 × n pour chaque vague n terminée (vague 10 : 110 au total)'],
  ['Wordle', 'trouvé en n essais : 40 + 15 × (6 − n), soit 115 du premier coup ; raté : 5'],
  ['À deux, victoire', 'Morpion 15 · Puissance 4 30 · Quarto 40 · Quoridor 60 · Dames 90 · Échecs 100'],
  ['À deux, sinon', 'nul : un tiers · défaite : 3 · victoire par abandon ou au temps : moitié'],
  ['Record personnel', '+100 (au moins 2 000 au 2048 et à Tetris, 10 tuyaux, vague 5)'],
  ['Record absolu', '+500 en battant le meilleur score de tous les joueurs'],
];
export const SCALE_NOTES = [
  'Les parties trop courtes et, au-delà de 10 parties par jour contre le même adversaire, les parties à deux ne rapportent rien.',
  'Les points sont attribués par le serveur quand il enregistre la partie : il faut être connecté (compte invité ou email).',
];

let wallet: Wallet | null = null;
const listeners = new Set<(w: Wallet | null) => void>();
const eventListeners = new Set<(e: PointEvent) => void>();
let channel: RealtimeChannel | null = null;
let watched = ''; // compte suivi : on change de canal si l'on se connecte à un autre compte

export function getWallet(): Wallet | null {
  return wallet;
}

export function onWallet(cb: (w: Wallet | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Chaque gain ou perte, en direct (pour les notifications « +120 points »). */
export function onPointEvent(cb: (e: PointEvent) => void): () => void {
  eventListeners.add(cb);
  return () => eventListeners.delete(cb);
}

let held = 0;
let pending: Wallet | null = null;

function setWallet(w: Wallet | null): void {
  if (held && w) {
    pending = w;
    return;
  }
  wallet = w;
  listeners.forEach((cb) => cb(w));
}

/**
 * Gèle l'affichage du solde (pendant qu'une roue tourne, le nouveau solde ne doit pas trahir le résultat).
 * Retourne la fonction qui le libère.
 */
export function holdWallet(): () => void {
  held++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held--;
    if (!held && pending) {
      const w = pending;
      pending = null;
      setWallet(w);
    }
  };
}

const MISSING = ['PGRST202', 'PGRST205', '42883', '42P01'];
const pointsError = (err: { code?: string }) =>
  new Error(MISSING.includes(err.code ?? '') ? 'Points indisponibles : migration 0007_points_casino.sql à exécuter (voir le README).' : errorMessage(err));

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Serveur non configuré');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw pointsError(error);
  return data as T;
}

/** Ouvre le portefeuille (points de bienvenue la première fois) et suit le solde en direct. */
export async function startPoints(me: string): Promise<void> {
  if (!multiConfigured || me === watched) return;
  watched = me;
  try {
    setWallet(await rpc<Wallet>('points_wallet'));
  } catch (e) {
    console.warn((e as Error).message);
    return;
  }
  const supabase = await getSupabase();
  if (!supabase || watched !== me) return;
  if (channel) void supabase.removeChannel(channel);
  channel = supabase
    .channel(`points:${me}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wallets', filter: `user_id=eq.${me}` }, (p) => {
      const row = p.new as { balance: number; earned: number };
      setWallet({ balance: Number(row.balance), earned: Number(row.earned) });
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'point_events', filter: `user_id=eq.${me}` }, (p) => {
      const e = p.new as PointEvent;
      eventListeners.forEach((cb) => cb({ ...e, amount: Number(e.amount) }));
    })
    .subscribe();
}

/** Relit le solde (après un achat). */
export async function refreshWallet(): Promise<void> {
  try {
    setWallet(await rpc<Wallet>('points_wallet'));
  } catch {
    // le solde se mettra à jour par Realtime
  }
}

export async function history(limit = 40): Promise<PointEvent[]> {
  const supabase = await getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('point_events')
    .select('id, amount, reason, kind, created_at')
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw pointsError(error);
  return ((data as PointEvent[] | null) ?? []).map((e) => ({ ...e, amount: Number(e.amount) }));
}

export interface RouletteResult {
  number: number;
  stake: number;
  payout: number;
  balance: number;
}

export async function spinRoulette(bets: Record<string, number>): Promise<RouletteResult> {
  const r = await rpc<RouletteResult>('casino_roulette', { bets });
  setWallet({ balance: r.balance, earned: wallet?.earned ?? 0 });
  return r;
}

export interface SlotsResult {
  reels: number[];
  stake: number;
  payout: number;
  balance: number;
}

export async function spinSlots(bet: number): Promise<SlotsResult> {
  const r = await rpc<SlotsResult>('casino_slots', { bet });
  setWallet({ balance: r.balance, earned: wallet?.earned ?? 0 });
  return r;
}

export const formatPoints = (n: number) => n.toLocaleString('fr-FR');
