import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  ready: boolean;
}

export interface Message<T = unknown> {
  type: string;
  payload: T;
  from: string;
  seq: number;
}

type Handler = (payload: any, msg: Message) => void;

// Sans I, L, O : pas de confusion avec 1 et 0.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

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
 * Un salon = un canal Realtime `room:<CODE>`.
 * Presence : liste des joueurs et état « prêt ». Broadcast : messages de jeu.
 * L'hôte est le joueur arrivé le plus tôt encore présent.
 */
export class Room {
  players: Player[] = [];
  private seq = 0;
  private lastSeq = new Map<string, number>();
  private handlers = new Map<string, Set<Handler>>();
  private playerListeners = new Set<(players: Player[]) => void>();
  private self: Player;

  private constructor(
    readonly code: string,
    private channel: RealtimeChannel,
    me: { id: string; name: string },
  ) {
    this.self = { ...me, joinedAt: Date.now(), ready: false };
  }

  get me(): Player {
    return this.self;
  }

  get hostId(): string | undefined {
    return this.players[0]?.id;
  }

  get isHost(): boolean {
    return this.hostId === this.self.id;
  }

  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  static async join(code: string, me: { id: string; name: string }): Promise<Room> {
    const supabase = await getSupabase();
    if (!supabase) throw new Error('Multijoueur non configuré');
    const channel = supabase.channel(`room:${code}`, {
      config: { presence: { key: me.id }, broadcast: { self: false } },
    });
    const room = new Room(code, channel, me);

    channel.on('presence', { event: 'sync' }, () => room.syncPlayers());
    channel.on('broadcast', { event: 'msg' }, ({ payload }) => room.receive(payload as Message));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Délai de connexion dépassé')), 10000);
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          await channel.track(room.self);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(new Error('Connexion au salon impossible'));
        }
      });
    });
    return room;
  }

  private syncPlayers(): void {
    const state = this.channel.presenceState<Player>();
    const list: Player[] = [];
    for (const metas of Object.values(state)) {
      const m = metas[0];
      if (m) list.push({ id: m.id, name: m.name, joinedAt: m.joinedAt, ready: m.ready });
    }
    list.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    this.players = list;
    this.playerListeners.forEach((cb) => cb(list));
  }

  private receive(msg: Message): void {
    if (!msg || typeof msg.type !== 'string') return;
    const last = this.lastSeq.get(msg.from) ?? 0;
    if (msg.seq <= last) return; // doublon ou message en retard
    this.lastSeq.set(msg.from, msg.seq);
    this.handlers.get(msg.type)?.forEach((h) => h(msg.payload, msg));
  }

  send(type: string, payload: unknown = null): void {
    const msg: Message = { type, payload, from: this.self.id, seq: ++this.seq };
    void this.channel.send({ type: 'broadcast', event: 'msg', payload: msg });
  }

  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  onPlayers(cb: (players: Player[]) => void): () => void {
    this.playerListeners.add(cb);
    return () => this.playerListeners.delete(cb);
  }

  async setReady(ready: boolean): Promise<void> {
    this.self = { ...this.self, ready };
    await this.channel.track(this.self);
  }

  async leave(): Promise<void> {
    this.handlers.clear();
    this.playerListeners.clear();
    try {
      await this.channel.untrack();
    } finally {
      const supabase = await getSupabase();
      await supabase?.removeChannel(this.channel);
    }
  }
}
