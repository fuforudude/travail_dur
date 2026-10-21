import type { Room } from '../net/room';

export interface GameContext {
  /** Élément racine que le jeu peut remplacer et remplir pendant toute sa durée de vie. */
  root: HTMLElement;
  /** Le jeu adapte son comportement ; en mode multi, `room` et `match` identifient le contexte serveur. */
  mode: 'solo' | 'multi';
  room?: Room;
  match?: string;
  /** Identité de la session courante, employée notamment pour reconnaître son camp en ligne. */
  me: { id: string; name: string };
  /** À appeler pour quitter proprement le jeu et revenir à la navigation précédente. */
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
  /**
   * Monte le jeu dans le DOM. Le nettoyage retourné doit retirer écouteurs, timers et abonnements :
   * le routeur l'exécute à chaque sortie de page.
   */
  mount(ctx: GameContext): () => void;
}
