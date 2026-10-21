import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export interface Player {
  id: string;
  name: string;
  busy: boolean; // en partie
}

// Sans I, L, O : pas de confusion avec 1 et 0.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function generateCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((c) => ALPHABET.includes(c))
    .join('')
    .slice(0, 4);
}

export function isValidCode(code: string): boolean {
  return normalizeCode(code) === code && code.length === 4;
}

/**
 * Un salon = un canal Realtime `room:<CODE>`, utilisé uniquement pour la presence (qui est là).
 * Rien de ce qui passe par ce canal ne fait foi : les pseudos viennent de la table profiles,
 * et les défis comme les coups passent par les fonctions du serveur.
 */
export class Room {
  players: Player[] = [];
  private names = new Map<string, string>();
  private playerListeners = new Set<(players: Player[]) => void>();
  private busy = false;
  private syncSeq = 0;

  private constructor(
    readonly code: string,
    readonly myId: string,
    private channel: RealtimeChannel,
  ) {}

  static async join(code: string, myId: string): Promise<Room> {
    const supabase = await getSupabase();
    if (!supabase) throw new Error('Indisponible en mode local.');
    const channel = supabase.channel(`room:${code}`, { config: { presence: { key: myId } } });
    const room = new Room(code, myId, channel);
    channel.on('presence', { event: 'sync' }, () => void room.syncPlayers());

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Délai de connexion dépassé')), 10000);
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          await channel.track({ busy: false });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(new Error('Connexion au salon impossible'));
        }
      });
    });
    return room;
  }

  private async syncPlayers(): Promise<void> {
    const seq = ++this.syncSeq;
    const state = this.channel.presenceState<{ busy?: unknown }>();
    // On ignore tout identifiant mal formé : il ne peut pas correspondre à un compte.
    const ids = Object.keys(state).filter((id) => UUID_RE.test(id)).slice(0, 50);
    // Pseudos relus à chaque synchro : un joueur a pu se renommer depuis son arrivée.
    if (ids.length) {
      const supabase = await getSupabase();
      const { data } = (await supabase?.from('profiles').select('id, username').in('id', ids)) ?? {};
      for (const p of data ?? []) this.names.set(p.id, p.username);
      if (seq !== this.syncSeq) return; // une synchro plus récente a pris le relais
    }
    this.players = ids
      .filter((id) => this.names.has(id)) // présence sans compte réel : ignorée
      .map((id) => ({ id, name: this.names.get(id)!, busy: state[id]?.[0]?.busy === true }))
      .sort((a, b) => (a.id === this.myId ? -1 : b.id === this.myId ? 1 : a.name.localeCompare(b.name)));
    this.playerListeners.forEach((cb) => cb(this.players));
  }

  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  nameOf(id: string): string | undefined {
    return this.names.get(id);
  }

  onPlayers(cb: (players: Player[]) => void): () => void {
    this.playerListeners.add(cb);
    return () => this.playerListeners.delete(cb);
  }

  async setBusy(busy: boolean): Promise<void> {
    if (busy === this.busy) return;
    this.busy = busy;
    await this.channel.track({ busy });
  }

  async leave(): Promise<void> {
    this.playerListeners.clear();
    try {
      await this.channel.untrack();
    } finally {
      const supabase = await getSupabase();
      await supabase?.removeChannel(this.channel);
    }
  }
}
