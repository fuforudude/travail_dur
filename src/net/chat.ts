import { errorMessage, getSupabase } from './supabase';

/** Ligne de public.room_messages. */
export interface ChatMessage {
  id: number;
  room: string;
  sender: string;
  body: string;
  created_at: string;
  /** Pseudo de l'auteur, joint à la lecture de l'historique (absent des messages reçus en direct). */
  profiles?: { username: string } | null;
}

const HISTORY = 50;
const MISSING = ['PGRST202', 'PGRST205', '42883', '42P01'];

const chatError = (err: { code?: string }) =>
  new Error(MISSING.includes(err.code ?? '') ? 'Chat indisponible : migration 0005_chat.sql à exécuter (voir le README).' : errorMessage(err));

/** Envoie un message : c'est le serveur qui renseigne l'auteur. */
export async function say(room: string, message: string): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('Indisponible en mode local.');
  const { error } = await supabase.rpc('room_say', { room_code: room, message });
  if (error) throw chatError(error);
}

/**
 * Messages du salon, en direct : `cb` reçoit d'abord l'historique récent, puis chaque nouveau message.
 * Les doublons éventuels (message reçu pendant la lecture de l'historique) sont au client de les filtrer par id.
 */
export async function watchChat(room: string, cb: (messages: ChatMessage[]) => void): Promise<() => void> {
  const supabase = await getSupabase();
  if (!supabase) return () => {};
  // Seuls les membres d'un salon lisent sa discussion (0037_securite.sql) : on le rejoint d'abord.
  const joined = await supabase.rpc('room_join', { room_code: room });
  if (joined.error && !MISSING.includes(joined.error.code ?? '')) throw chatError(joined.error);
  // S'abonner d'abord, puis lire : aucun message ne peut se perdre entre les deux.
  const channel = supabase
    .channel(`chat:${room}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room=eq.${room}` }, (p) =>
      cb([p.new as ChatMessage]),
    )
    .subscribe();
  const { data, error } = await supabase
    .from('room_messages')
    .select('id, room, sender, body, created_at, profiles(username)')
    .eq('room', room)
    .gt('created_at', new Date(Date.now() - 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(HISTORY);
  if (error) {
    void supabase.removeChannel(channel);
    throw chatError(error);
  }
  cb(((data as unknown as ChatMessage[] | null) ?? []).reverse());
  return () => void supabase.removeChannel(channel);
}
