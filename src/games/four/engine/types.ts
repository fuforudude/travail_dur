// Jeux de plateau à 4 joueurs (échecs à 4, corridor à 4) : types communs.
// Ce dossier (engine/) ne touche pas à la page : il tourne aussi dans la fonction serveur
// supabase/functions/board4 (copié par scripts/td-sync.mjs), qui valide chaque coup avec ce même code.

/** Place autour du plateau : 0 en bas, 1 à gauche, 2 en haut, 3 à droite (ordre de jeu). */
export type Seat = 0 | 1 | 2 | 3;
export const SEATS: Seat[] = [0, 1, 2, 3];

export interface Rules4 {
  id: 'chess4' | 'quoridor4';
  initial(): number[];
  /** Coups légaux de `seat` (« pass » s'il doit passer son tour). */
  moves(b: number[], seat: Seat): string[];
  isLegal(b: number[], seat: Seat, mv: string): boolean;
  /** Joue un coup supposé légal ; ne modifie pas `b`. */
  apply(b: number[], seat: Seat, mv: string): number[];
  /** Joueur encore en jeu ? */
  alive(b: number[], seat: Seat): boolean;
  /**
   * Après le coup de `mover` : éliminations éventuelles (mat, pat…), vainqueur, ou joueur suivant.
   * `plies` = nombre total de coups joués (pour arrêter une partie interminable).
   */
  advance(b: number[], mover: Seat, plies: number): { board: number[]; next: Seat | null; winner: Seat | null; draw: boolean };
}

/** Ordinateur : un coup pour `seat`. */
export type Ai4 = (b: number[], seat: Seat) => string;

/** Joueur suivant encore en jeu (sens des aiguilles d'une montre), ou null. */
export function nextAlive(rules: Rules4, b: number[], from: Seat): Seat | null {
  for (let k = 1; k <= 4; k++) {
    const s = ((from + k) % 4) as Seat;
    if (rules.alive(b, s)) return s;
  }
  return null;
}
