// Contrat commun des jeux à deux au tour par tour (Puissance 4, Morpion) :
// une vue qui affiche un état et remonte les intentions du joueur, quel que soit le mode.

/** Ce que le plateau affiche ; le mode solo et le mode en ligne le remplissent chacun à leur façon. */
export interface ViewState {
  board: number[]; // 0 = vide, 1 = joueur 1, 2 = joueur 2
  names: [string, string];
  /** Mon camp (0 = joueur 1), ou null si je ne joue pas. */
  me: 0 | 1 | null;
  turn: 0 | 1;
  result: null | 'draw' | 0 | 1;
  line: number[];
  last: number | null;
  scores: [number, number];
  /** Remplace le texte de statut calculé par défaut. */
  message?: string;
}

export interface ViewHandlers {
  /** Puissance 4 : une colonne. Morpion : une case. */
  play(cell: number): void;
  rematch(): void;
  exit(): void;
  /** Touches propres à un mode (ex. réclamer la victoire en ligne). Retourne true si gérée. */
  key?(key: string): boolean;
}

export interface DuelView {
  update(state: ViewState): void;
  destroy(): void;
}

export type CreateView = (root: HTMLElement, handlers: ViewHandlers, extraHints?: [string, string][]) => DuelView;

/** Texte de statut par défaut, partagé par les vues. */
export function statusText(s: ViewState, myTurn: boolean): string {
  if (s.message) return s.message;
  if (s.result === 'draw') return 'Match nul. R pour la revanche.';
  if (s.result !== null) return (s.result === s.me ? 'Gagné !' : `${s.names[s.result]} gagne.`) + ' R pour la revanche.';
  if (myTurn) return 'À toi de jouer.';
  return `${s.names[s.turn]} réfléchit…`;
}
