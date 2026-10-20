// Socle commun des jeux de plateau à deux dont les coups sont du texte (Échecs, Dames, Quoridor, Quarto).
// Un état est un tableau de nombres : c'est exactement la colonne `board` de public.matches,
// et chaque jeu a son jumeau SQL (supabase/migrations/0006_plateaux.sql) qui doit rester identique.

import { isPanicked, onPanicChange } from '../core/panic';
import { blip } from '../core/sound';
import { cosmeticOf, nameEl } from '../net/cosmetics';
import { getAccount } from '../net/auth';
import { h, hints } from '../ui/dom';
import type { CreateView, ViewState } from './duel';
import type { Ai, Rules, Side } from './engine';
import type { GameContext } from './types';

export type { Ai, Outcome, Rules, Side } from './engine';
export { negamax, WIN } from './engine';

/** Partie solo contre l'ordinateur, entièrement locale (non classée). */
export function mountSoloBoard(ctx: GameContext, createView: CreateView, rules: Rules, ai: Ai | ((b: number[], side: Side, history: string[]) => Promise<string>)): () => void {
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
    ids: [getAccount()?.id ?? null, null],
  };
  let starter: 0 | 1 = 0;
  let mySide: 0 | 1 = 0; // les camps s'échangent à chaque revanche, comme en ligne
  let aiTimer: number | undefined;
  let generation = 0;
  let disposed = false;

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

  let thinking = 0; // numéro de la réflexion en cours : une réponse arrivée après une revanche est ignorée
  const scheduleAi = () => {
    if (s.result !== null || s.turn === mySide || aiTimer || thinking) return;
    aiTimer = window.setTimeout(async () => {
      aiTimer = undefined;
      if (isPanicked()) return; // reprise à la sortie du faux écran
      const ticket = ++generation;
      thinking = ticket;
      const mv = await ai(board, (s.turn + 1) as Side, history);
      if (thinking !== ticket || disposed) return;
      thinking = 0;
      play(mv);
    }, 350);
  };

  const view = createView(ctx.root, {
    play: (mv) => typeof mv === 'string' && s.turn === mySide && play(mv),
    rematch: () => {
      if (s.result === null) return;
      thinking = 0;
      starter = (1 - starter) as 0 | 1;
      mySide = starter; // le camp 1 commence toujours : on change de camp
      board = rules.initial();
      history = [];
      const names: [string, string] = mySide === 0 ? [ctx.me.name, 'Ordinateur'] : ['Ordinateur', ctx.me.name];
      const scores: [number, number] = [s.scores[1], s.scores[0]];
      const myId = getAccount()?.id ?? null;
      const ids: [string | null, string | null] = mySide === 0 ? [myId, null] : [null, myId];
      s = { ...s, board, history, names, scores, ids, me: mySide, turn: 0, result: null, line: [], last: null };
      view.update(s);
      scheduleAi();
    },
    exit: () => ctx.onExit(),
  });
  const offPanic = onPanicChange((paused) => !paused && scheduleAi());
  view.update(s);

  return () => {
    disposed = true;
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
): { game: HTMLElement; legend: HTMLElement; status: HTMLElement; toggleRules(): void } {
  const legend = h('div', { class: 'game-bar' });
  const status = h('p', { class: 'status' }, 'Chargement…');
  const rules = h('div', { class: 'rules card', hidden: true }, h('h2', {}, 'Règles'), ...opts.rules.map((p) => h('p', {}, p)));
  const button = h('button', { class: 'rules-btn', type: 'button' }, 'Règles (I)');
  const toggleRules = () => {
    rules.hidden = !rules.hidden;
  };
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', toggleRules);
  const game = h(
    'div',
    { class: 'game' },
    legend,
    h('div', { class: 'board-wrap' }, opts.board, opts.side ?? null),
    status,
    button,
    rules,
    hints(...opts.keys, ['I', 'règles'], ['R', 'revanche'], ['Retour arrière', 'quitter']),
  );
  root.append(game);
  return { game, legend, status, toggleRules };
}

/** Pastilles des deux joueurs dans la barre du haut. */
export function legendItems(s: ViewState, mark: (p: 0 | 1) => Node): HTMLElement[] {
  return [0, 1].map((p) =>
    h(
      'span',
      { class: 'stat' + (s.result === null && s.turn === p ? ' active' : '') },
      mark(p as 0 | 1),
      ' ',
      playerName(s, p as 0 | 1),
      ' ',
      h('b', {}, String(s.scores[p])),
    ),
  );
}

/** Pseudo d'un joueur dans la barre du haut, avec sa couleur et son effet, et « (toi) ». */
export function playerName(s: ViewState, p: 0 | 1): HTMLElement {
  const id = s.ids?.[p] ?? null;
  void cosmeticOf(id); // lance le chargement si besoin
  return h('span', {}, nameEl(id, s.names[p]), s.me === p ? ' (toi)' : '');
}
