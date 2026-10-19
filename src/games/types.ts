import type { Room } from '../net/room';

export interface GameContext {
  root: HTMLElement;
  mode: 'solo' | 'multi';
  room?: Room; // présent en multi
  match?: string; // en multi : identifiant de la partie côté serveur
  me: { id: string; name: string };
  onExit(): void;
}

export interface Game {
  id: string;
  name: string;
  /** Courte description affichée dans l'accueil. */
  description?: string;
  modes: ('solo' | 'multi')[];
  minPlayers?: number;
  maxPlayers?: number;
  mount(ctx: GameContext): () => void; // retourne une fonction de nettoyage
}
