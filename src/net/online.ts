// Joueurs connectés : un canal Realtime `online` en présence (comme les salons, net/room.ts).
// Chaque onglet ouvert y annonce son compte et ce qu'il fait (page du site). Rien n'y fait foi :
// les pseudos sont relus dans la table profiles, et l'activité annoncée est filtrée sur une liste connue.

import type { RealtimeChannel } from '@supabase/supabase-js';
import { isPanicked, onPanicChange } from '../core/panic';
import { load, save } from '../core/storage';
import { getGame } from '../games/registry';
import { getSupabase, multiConfigured } from './supabase';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HIDDEN_KEY = 'online:hidden';
const MAX = 200;

export interface OnlinePlayer {
  id: string;
  name: string;
  /** Code d'activité (« game:2048 », « roulette »…), voir activityLabel. */
  at: string;
  away: boolean;
}

const PAGES: Record<string, string> = {
  home: 'sur l’accueil',
  roulette: 'à la roulette',
  slots: 'à la machine à sous',
  points: 'au casino',
  shop: 'à la boutique',
  crates: 'ouvre des caisses',
  appart: 'dans un appart',
  friends: 'avec ses amis',
  scores: 'regarde les classements',
  room: 'dans un salon',
  watch: 'regarde quelqu’un jouer',
  other: 'sur le site',
};

/** Ce que fait le joueur, en clair (« joue au 2048 »). */
export function activityLabel(at: string): string {
  if (at.startsWith('game:')) {
    const name = getGame(at.slice(5))?.name ?? 'un jeu';
    return `joue ${/^(Échecs|Dames)/.test(name) ? 'aux' : 'au'} ${name.replace(/^(Échecs|Dames)/, (w) => w.toLowerCase())}`;
  }
  return PAGES[at] ?? PAGES.other;
}

/** Les pages où l'on peut regarder le joueur en direct (net/spectate.ts). */
export const atCasino = (at: string) => at === 'roulette' || at === 'slots';

function activity(): string {
  const path = location.hash.replace(/^#/, '') || '/';
  const game = /^\/game\/([\w-]+)/.exec(path);
  if (game && getGame(game[1])) return `game:${game[1]}`;
  if (path === '/') return 'home';
  if (path.startsWith('/td/caisses') || path === '/caisses') return 'crates';
  const first = path.split('/')[1];
  const map: Record<string, string> = { roulette: 'roulette', slots: 'slots', points: 'points', shop: 'shop', appart: 'appart', amis: 'friends', scores: 'scores', room: 'room', join: 'room', regarder: 'watch' };
  return map[first] ?? 'other';
}

const valid = (at: unknown): at is string => typeof at === 'string' && (at in PAGES || (at.startsWith('game:') && Boolean(getGame(at.slice(5)))));

let channel: RealtimeChannel | null = null;
let me = '';
let players: OnlinePlayer[] = [];
let hidden = load<boolean>(HIDDEN_KEY, false);
const names = new Map<string, string>();
const listeners = new Set<(list: OnlinePlayer[]) => void>();
let syncSeq = 0;
let wired = false;

export const onlinePlayers = () => players;
export const isHiddenOnline = () => hidden;

export function onOnline(cb: (list: OnlinePlayer[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function sync(): Promise<void> {
  if (!channel) return;
  const seq = ++syncSeq;
  const state = channel.presenceState<{ at?: unknown; away?: unknown }>();
  const ids = Object.keys(state).filter((id) => UUID_RE.test(id)).slice(0, MAX);
  const missing = ids.filter((id) => !names.has(id));
  if (missing.length) {
    const supabase = await getSupabase();
    const { data } = (await supabase?.from('profiles').select('id, username').in('id', missing)) ?? {};
    for (const p of (data as { id: string; username: string }[] | null) ?? []) names.set(p.id, p.username);
    if (seq !== syncSeq) return;
  }
  players = ids
    .filter((id) => names.has(id)) // présence sans compte réel : ignorée
    .map((id) => {
      // Plusieurs onglets : le plus actif l'emporte.
      const metas = state[id] ?? [];
      const best = metas.find((m) => !m.away && valid(m.at)) ?? metas.find((m) => valid(m.at));
      return { id, name: names.get(id)!, at: valid(best?.at) ? best.at : 'other', away: !metas.some((m) => !m.away) };
    })
    .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : Number(a.away) - Number(b.away) || a.name.localeCompare(b.name)));
  listeners.forEach((cb) => cb(players));
}

// Absent : onglet en arrière-plan ou écran panique (le site ne doit rien trahir de ce qu'on y fait).
const announce = () => {
  if (!channel || hidden) return;
  const away = document.hidden || isPanicked();
  void channel.track({ at: away ? 'other' : activity(), away });
};

/** Rejoint la liste des joueurs connectés (une fois le compte connu). */
export async function startOnline(uid: string): Promise<void> {
  if (!multiConfigured || uid === me) return;
  const supabase = await getSupabase();
  if (!supabase) return;
  if (channel) void supabase.removeChannel(channel);
  me = uid;
  names.clear();
  channel = supabase.channel('online', { config: { presence: { key: uid } } });
  channel.on('presence', { event: 'sync' }, () => void sync());
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') announce();
  });
  if (!wired) {
    wired = true;
    window.addEventListener('hashchange', announce);
    document.addEventListener('visibilitychange', announce);
    onPanicChange(announce);
  }
}

/** Ne plus apparaître dans la liste (on la voit toujours), ou y revenir. Retenu dans le navigateur. */
export function setHiddenOnline(value: boolean): void {
  hidden = value;
  save(HIDDEN_KEY, value);
  if (!channel) return;
  if (value) void channel.untrack();
  else announce();
}
