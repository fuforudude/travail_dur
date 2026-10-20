// Socle commun des jeux de plateau à deux dont les coups sont du texte (Échecs, Dames, Quoridor, Quarto).
// Un état est un tableau de nombres : c'est exactement la colonne `board` de public.matches,
// et chaque jeu a son jumeau SQL (supabase/migrations/0006_plateaux.sql) qui doit rester identique.

import { isPanicked, onPanicChange } from '../core/panic';
import { blip } from '../core/sound';
import { h, hints } from '../ui/dom';
import type { CreateView, ViewState } from './duel';
import type { GameContext } from './types';

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

/** Partie solo contre l'ordinateur, entièrement locale (non classée). */
export function mountSoloBoard(ctx: GameContext, createView: CreateView, rules: Rules, ai: Ai): () => void {
  let board = rules.initial();
  let history: string[] = [];
  let s: ViewState = {
    board,
    names: [ctx.me.name, 'Ordinateur'],
    me: 0,
    turn: 0,
    result: null,
    line: [],
    last: null,
    scores: [0, 0],
    history,
  };
  let starter: 0 | 1 = 0;
  let mySide: 0 | 1 = 0; // les camps s'échangent à chaque revanche, comme en ligne
  let aiTimer: number | undefined;

  const play = (mv: string) => {
    if (s.result !== null) return;
    const side = (s.turn + 1) as Side;
    if (!rules.isLegal(board, side, mv)) return;
    board = rules.apply(board, side, mv);
    history = [...history, mv];
    const next = (3 - side) as Side;
    const o = rules.outcome(board, next, history);
    s = { ...s, board, history, turn: (next - 1) as 0 | 1 };
    if (o) {
      s.result = o.winner ? ((o.winner - 1) as 0 | 1) : 'draw';
      s.line = o.line ?? [];
      if (o.winner) {
        s.scores = s.scores.slice() as [number, number];
        s.scores[o.winner - 1]++;
      }
    }
    blip(260);
    view.update(s);
    scheduleAi();
  };

  const scheduleAi = () => {
    if (s.result !== null || s.turn === mySide || aiTimer) return;
    aiTimer = window.setTimeout(() => {
      aiTimer = undefined;
      if (isPanicked()) return; // reprise à la sortie du faux écran
      play(ai(board, (s.turn + 1) as Side, history));
    }, 350);
  };

  const view = createView(ctx.root, {
    play: (mv) => typeof mv === 'string' && s.turn === mySide && play(mv),
    rematch: () => {
      if (s.result === null) return;
      starter = (1 - starter) as 0 | 1;
      mySide = starter; // le camp 1 commence toujours : on change de camp
      board = rules.initial();
      history = [];
      const names: [string, string] = mySide === 0 ? [ctx.me.name, 'Ordinateur'] : ['Ordinateur', ctx.me.name];
      const scores: [number, number] = [s.scores[1], s.scores[0]];
      s = { ...s, board, history, names, scores, me: mySide, turn: 0, result: null, line: [], last: null };
      view.update(s);
      scheduleAi();
    },
    exit: () => ctx.onExit(),
  });
  const offPanic = onPanicChange((paused) => !paused && scheduleAi());
  view.update(s);

  return () => {
    clearTimeout(aiTimer);
    offPanic();
    view.destroy();
  };
}

/**
 * Habillage commun : barre des joueurs, plateau, statut, aide clavier et règles (touche I).
 * La vue de chaque jeu ne s'occupe que du plateau.
 */
export function boardShell(
  root: HTMLElement,
  opts: { board: HTMLElement; side?: HTMLElement; keys: [string, string][]; rules: string[] },
): { legend: HTMLElement; status: HTMLElement; toggleRules(): void } {
  const legend = h('div', { class: 'game-bar' });
  const status = h('p', { class: 'status' }, 'Chargement…');
  const rules = h('div', { class: 'rules card', hidden: true }, h('h2', {}, 'Règles'), ...opts.rules.map((p) => h('p', {}, p)));
  const button = h('button', { class: 'rules-btn', type: 'button' }, 'Règles (I)');
  const toggleRules = () => {
    rules.hidden = !rules.hidden;
  };
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', toggleRules);
  root.append(
    h(
      'div',
      { class: 'game' },
      legend,
      h('div', { class: 'board-wrap' }, opts.board, opts.side ?? null),
      status,
      button,
      rules,
      hints(...opts.keys, ['I', 'règles'], ['R', 'revanche'], ['Retour arrière', 'quitter']),
    ),
  );
  return { legend, status, toggleRules };
}

/** Pastilles des deux joueurs dans la barre du haut. */
export function legendItems(s: ViewState, mark: (p: 0 | 1) => Node): HTMLElement[] {
  return [0, 1].map((p) =>
    h(
      'span',
      { class: 'stat' + (s.result === null && s.turn === p ? ' active' : '') },
      mark(p as 0 | 1),
      ' ',
      s.me === p ? `${s.names[p]} (toi)` : s.names[p],
      ' ',
      h('b', {}, String(s.scores[p])),
    ),
  );
}
