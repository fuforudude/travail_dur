import { isTyping, pushKeys } from '../../core/input';
import { applySkins } from '../../net/cosmetics';
import { h } from '../../ui/dom';
import { boardShell, legendItems, type Side } from '../board';
import { statusText, type DuelView, type ViewHandlers, type ViewState } from '../duel';
import { indexAt, isKing, moves, sideOf } from './logic';

export const RULES = [
  'Plateau de 10×10, 20 pions par camp sur les cases foncées. Les blancs commencent. On gagne quand l’adversaire n’a plus de pièce ou ne peut plus jouer.',
  'Un pion avance d’une case en diagonale vers l’avant. Il prend en sautant par-dessus une pièce adverse collée à lui, vers l’avant comme vers l’arrière, s’il y a une case libre juste derrière. Il peut enchaîner plusieurs prises dans le même coup (rafle).',
  'Un pion qui termine son coup sur la dernière rangée devient une dame. La dame se déplace en diagonale d’autant de cases qu’elle veut, et prend à distance : elle saute une pièce adverse et s’arrête sur n’importe quelle case libre derrière.',
  'La prise est obligatoire, et il faut choisir la rafle qui prend le plus de pièces (une dame compte comme un pion). Les pièces prises ne sont retirées qu’à la fin du coup, et on ne peut pas sauter deux fois la même.',
  'Partie nulle si les deux camps jouent 25 coups chacun uniquement avec des dames, sans prise.',
  'Clavier : flèches pour bouger le curseur, Entrée sur une pièce puis sur chaque case d’arrivée de la rafle. Les cases possibles sont marquées d’un point.',
];

/** Un coup « 31x22x13 » ou « 31-27 » sous forme de liste de cases. */
const squares = (mv: string) => mv.split(/[x-]/).map(Number);

export function createView(root: HTMLElement, handlers: ViewHandlers, extraHints: [string, string][] = []): DuelView {
  let state: ViewState | null = null;
  let cursor = 32; // position affichée (ligne * 10 + colonne)
  let path: number[] = []; // cases déjà choisies : la pièce, puis les arrêts de la rafle

  const cells = Array.from({ length: 100 }, (_, v) => h('div', { class: 'dm-sq', 'data-v': v }));
  const board = h('div', { class: 'dames' }, ...cells);
  const { game, legend, status, toggleRules } = boardShell(root, {
    board,
    keys: [['← ↑ → ↓', 'case'], ['Entrée', 'choisir / jouer'], ...extraHints],
    rules: RULES,
  });

  const mySide = (): Side | null => (state && state.me !== null ? ((state.me + 1) as Side) : null);
  const flipped = () => state?.me === 1;
  /** Case foncée (0..49) sous la position affichée, ou -1. */
  const squareAt = (v: number) => {
    const r = Math.floor(v / 10);
    const c = v % 10;
    return flipped() ? indexAt(9 - r, 9 - c) : indexAt(r, c);
  };
  const myTurn = () => state !== null && state.result === null && state.me !== null && state.turn === state.me;
  const legal = () => (myTurn() ? moves(state!.board, mySide()!).map((m) => ({ mv: m, sq: squares(m) })) : []);
  /** Coups qui commencent par le chemin déjà choisi. */
  const matching = () => legal().filter((m) => path.every((x, k) => m.sq[k] === x));

  const render = () => {
    if (!state) return;
    const s = state;
    applySkins(game, 'checkers', s.ids);
    legend.replaceChildren(...legendItems(s, (p) => h('span', { class: `dm-mark p${p + 1}` })));
    const all = legal();
    const fit = matching();
    const next = new Set(path.length ? fit.map((m) => m.sq[path.length]).filter((x) => x !== undefined) : all.map((m) => m.sq[0]));
    const last = s.history?.at(-1);
    const lastSquares = last ? squares(last) : [];
    cells.forEach((el, v) => {
      const i = squareAt(v);
      if (i < 0) {
        el.className = 'dm-sq light';
        el.replaceChildren();
        return;
      }
      const p = s.board[i];
      el.replaceChildren(p ? h('span', { class: `dm-piece p${sideOf(p)}` + (isKing(p) ? ' king' : '') }) : '');
      el.className =
        'dm-sq' +
        (lastSquares.includes(i) ? ' last' : '') +
        (path.includes(i) ? ' sel' : '') +
        (next.has(i) ? (path.length ? ' target' : ' movable') : '') +
        (myTurn() && v === cursor ? ' cursor' : '');
    });
    let text = statusText(s, myTurn());
    if (myTurn() && !s.message && all.some((m) => m.mv.includes('x'))) {
      const n = all[0].sq.length - 1;
      text += n > 1 ? ` Prise obligatoire : ${n} pièces.` : ' Prise obligatoire.';
    }
    status.textContent = text;
  };

  const activate = (i: number) => {
    if (!state) return;
    if (state.result !== null) return handlers.rematch();
    if (!myTurn() || i < 0) return;
    const fit = matching();
    if (path.length && fit.some((m) => m.sq[path.length] === i)) {
      path = [...path, i];
      const done = matching().find((m) => m.sq.length === path.length);
      if (done) {
        path = [];
        handlers.play(done.mv);
      }
      return render();
    }
    // Sinon : (re)choisir une pièce, ou annuler.
    path = legal().some((m) => m.sq[0] === i) && path[0] !== i ? [i] : [];
    render();
  };

  cells.forEach((el, v) => {
    el.addEventListener('mouseenter', () => {
      cursor = v;
      render();
    });
    el.addEventListener('click', () => activate(squareAt(v)));
  });

  const moveCursor = (dr: number, dc: number) => {
    const r = Math.max(0, Math.min(9, Math.floor(cursor / 10) + dr));
    const c = Math.max(0, Math.min(9, (cursor % 10) + dc));
    cursor = r * 10 + c;
    render();
  };

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'q' || key === 'a') moveCursor(0, -1);
    else if (key === 'arrowright' || key === 'd') moveCursor(0, 1);
    else if (key === 'arrowup' || key === 'z' || key === 'w') moveCursor(-1, 0);
    else if (key === 'arrowdown' || key === 's') moveCursor(1, 0);
    else if (key === 'enter' || key === ' ') activate(squareAt(cursor));
    else if (key === 'i') toggleRules();
    else if (key === 'r') handlers.rematch();
    else if (key === 'backspace') {
      if (path.length) {
        path = [];
        render();
      } else handlers.exit();
    } else if (!handlers.key?.(key)) return;
    e.preventDefault();
  });

  return {
    update(next) {
      if (!state || state.history?.length !== next.history?.length || state.me !== next.me) path = [];
      state = next;
      render();
    },
    destroy: popKeys,
  };
}
