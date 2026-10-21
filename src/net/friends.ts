// Amis et notifications (supabase/migrations/0017_amis.sql). Le serveur fait foi pour tout :
// ce module appelle ses fonctions et suit les notifications en direct.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { errorMessage, getSupabase, multiConfigured } from './supabase';

export type Relation = 'friend' | 'sent' | 'received' | 'none';

export interface Friend {
  id: string;
  username: string;
  status: Exclude<Relation, 'none'>;
}

export interface Notification {
  id: number;
  kind: 'friend_request' | 'friend_accepted' | 'room_invite';
  from_id: string | null;
  room: string | null;
  game: string | null;
  read: boolean;
  created_at: string;
  /** Pseudo de l'expéditeur, complété côté site. */
  from_name?: string;
}

const MISSING = ['PGRST202', 'PGRST205', '42883', '42P01'];
const friendsError = (err: { code?: string }) =>
  new Error(MISSING.includes(err.code ?? '') ? 'Amis indisponibles : migration 0017_amis.sql à exécuter (voir le README).' : errorMessage(err));

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Indisponible en mode local.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw friendsError(error);
  return data as T;
}

export const friendList = () => rpc<Friend[]>('friend_list');
export const searchPlayers = (search: string) => rpc<{ id: string; username: string; relation: Relation }[]>('friend_search', { search });
export const requestFriend = (target: string) => rpc<'friend' | 'sent'>('friend_request', { target });
export const respondFriend = (other: string, accept: boolean) => rpc<void>('friend_respond', { other, accept });
export const removeFriend = (other: string) => rpc<void>('friend_remove', { other });
export const inviteToRoom = (friend: string, room: string, game: string) => rpc<void>('room_invite', { friend, room_code: room, game_id: game });
export const markRead = (ids: number[] | null) => rpc<void>('notifications_read', { ids });

// ---------------------------------------------------------------------------
// Notifications en direct
// ---------------------------------------------------------------------------

let notes: Notification[] = [];
const listeners = new Set<(all: Notification[], fresh: Notification | null) => void>();
let channel: RealtimeChannel | null = null;
let watched = '';

export const getNotifications = () => notes;
export const unreadCount = () => notes.filter((n) => !n.read).length;

/** `fresh` : la notification qui vient d'arriver (null pour un simple rechargement). */
export function onNotifications(cb: (all: Notification[], fresh: Notification | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const emit = (fresh: Notification | null) => listeners.forEach((cb) => cb(notes, fresh));

async function withNames(list: Notification[]): Promise<Notification[]> {
  const supabase = await getSupabase();
  const ids = [...new Set(list.map((n) => n.from_id).filter((x): x is string => Boolean(x)))];
  if (!supabase || !ids.length) return list;
  const { data } = await supabase.from('profiles').select('id, username').in('id', ids);
  const names = new Map((data ?? []).map((p: { id: string; username: string }) => [p.id, p.username]));
  return list.map((n) => ({ ...n, from_name: n.from_id ? names.get(n.from_id) : undefined }));
}

export async function refreshNotifications(): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase || !watched) return;
  const { data, error } = await supabase.from('notifications').select('*').order('id', { ascending: false }).limit(30);
  if (error) return; // amis pas encore installés côté serveur
  notes = await withNames(((data as Notification[] | null) ?? []).map((n) => ({ ...n, id: Number(n.id) })));
  emit(null);
}

/** Suit les notifications du compte connecté (appelé au démarrage, et si l'on change de compte). */
export async function startNotifications(me: string): Promise<void> {
  if (!multiConfigured || me === watched) return;
  watched = me;
  const supabase = await getSupabase();
  if (!supabase) return;
  if (channel) void supabase.removeChannel(channel);
  channel = supabase
    .channel(`notifs:${me}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` }, async (p) => {
      if (p.eventType === 'INSERT') {
        const [fresh] = await withNames([{ ...(p.new as Notification), id: Number((p.new as Notification).id) }]);
        notes = [fresh, ...notes.filter((n) => n.id !== fresh.id)].slice(0, 30);
        emit(fresh);
      } else void refreshNotifications();
    })
    .subscribe();
  await refreshNotifications();
}

/** « jouer au Morpion », « jouer aux Échecs »… */
export const DUEL_NAMES: Record<string, string> = {
  connect4: 'au Puissance 4',
  tictactoe: 'au Morpion',
  chess: 'aux Échecs',
  checkers: 'aux Dames',
  quoridor: 'au Quoridor',
  quarto: 'au Quarto',
};

/** Phrase d'une notification, pour l'affichage. */
export function noteText(n: Notification): string {
  const who = n.from_name ?? 'Un joueur';
  if (n.kind === 'friend_request') return `${who} veut être ton ami.`;
  if (n.kind === 'friend_accepted') return `${who} a accepté ta demande d’ami.`;
  return `${who} t’invite à jouer${n.game && DUEL_NAMES[n.game] ? ` ${DUEL_NAMES[n.game]}` : ''} (salon ${n.room}).`;
}
