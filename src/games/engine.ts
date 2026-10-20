// Moteur des jeux de plateau : types communs et recherche de l'ordinateur.
// Aucun accès à la page ici : ce module tourne aussi dans un Web Worker (games/ai.worker.ts),
// pour que l'ordinateur réfléchisse sans figer l'écran.

export type Side = 1 | 2;

/** Fin de partie : vainqueur (null = nul) et éventuelles cases à surligner. */
export interface Outcome {
  winner: Side | null;
  line?: number[];
}

export interface Rules {
  initial(): number[];
  /** Tous les coups légaux du camp `side`. */
  moves(b: number[], side: Side): string[];
  isLegal(b: number[], side: Side, mv: string): boolean;
  /** Joue un coup supposé légal ; ne modifie pas `b`. */
  apply(b: number[], side: Side, mv: string): number[];
  /** Après un coup : `next` est le camp qui doit jouer, `history` contient tous les coups joués. */
  outcome(b: number[], next: Side, history: string[]): Outcome | null;
}

/** Ordinateur : un coup pour `side`. */
export type Ai = (b: number[], side: Side, history: string[]) => string;

/**
 * Recherche alpha-bêta générique (negamax), pour l'ordinateur.
 * - `evaluate` note la position du point de vue de `side` (positif = bon pour lui) ;
 * - `over` détecte, juste après un coup, une fin de partie immédiate (pion arrivé, ligne complète…) ;
 * - `stuck` note la position quand `side` n'a plus de coup (mat, pat, plus de pièces…).
 * On n'appelle pas `rules.outcome`, trop coûteux à chaque nœud (répétitions, etc.).
 */
export function negamax(
  rules: Rules,
  opts: {
    depth: number | ((b: number[]) => number);
    evaluate(b: number[], side: Side): number;
    over?(b: number[], mover: Side): Outcome | null;
    stuck(b: number[], side: Side): number;
    moves?(b: number[], side: Side): string[];
    order?(b: number[], side: Side, moves: string[]): string[];
  },
): Ai {
  const gen = (b: number[], side: Side) => {
    const m = (opts.moves ?? rules.moves)(b, side);
    return opts.order ? opts.order(b, side, m) : m;
  };
  const scoreOver = (o: Outcome, mover: Side, depth: number) => (o.winner === mover ? WIN + depth : o.winner ? -WIN - depth : 0);
  const search = (b: number[], side: Side, depth: number, alpha: number, beta: number): number => {
    if (depth === 0) return opts.evaluate(b, side);
    const moves = gen(b, side);
    if (!moves.length) return opts.stuck(b, side);
    let best = -Infinity;
    for (const mv of moves) {
      const nb = rules.apply(b, side, mv);
      const o = opts.over?.(nb, side);
      const score = o ? scoreOver(o, side, depth) : -search(nb, (3 - side) as Side, depth - 1, -beta, -alpha);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };
  return (b, side) => {
    const depth = typeof opts.depth === 'number' ? opts.depth : opts.depth(b);
    const moves = gen(b, side);
    let best = moves[0];
    let bestScore = -Infinity;
    for (const mv of moves) {
      const nb = rules.apply(b, side, mv);
      const o = opts.over?.(nb, side);
      // Un peu de hasard entre coups équivalents, pour ne pas rejouer toujours la même partie.
      const score = (o ? scoreOver(o, side, depth) : -search(nb, (3 - side) as Side, depth - 1, -Infinity, -bestScore + 1)) + Math.random();
      if (score > bestScore) {
        bestScore = score;
        best = mv;
      }
    }
    return best;
  };
}

export const WIN = 1e6;
