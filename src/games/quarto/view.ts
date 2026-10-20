import { isTyping, pushKeys } from '../../core/input';
import { h } from '../../ui/dom';
import { boardShell, legendItems } from '../board';
import { statusText, type DuelView, type ViewHandlers, type ViewState } from '../duel';
import { available, winningLine } from './logic';

export const RULES = [
  '16 pièces toutes différentes, avec 4 caractéristiques : haute ou basse, foncée ou claire, carrée ou ronde, creuse ou pleine.',
  'Le but : compléter une ligne de 4 pièces (ligne, colonne ou diagonale) qui ont au moins une caractéristique en commun, par exemple 4 pièces hautes, ou 4 rondes. Peu importe qui a posé les autres pièces.',
  'La particularité : on ne choisit pas la pièce qu’on pose. À chaque tour, on pose la pièce que l’adversaire nous a donnée, puis on choisit celle qu’il devra poser. Au tout premier tour, on se contente de donner une pièce.',
  'Partie nulle si le plateau est plein sans ligne gagnante.',
  'Clavier : flèches pour bouger le curseur, Entrée pour poser sur la case, puis flèches et Entrée dans la réserve pour donner une pièce. Tab passe du plateau à la réserve.',
];

const TRAITS = ['haute', 'foncée', 'carrée', 'creuse'];
const OPPOSITE = ['basse', 'claire', 'ronde', 'pleine'];
export const describe = (p: number) => TRAITS.map((t, k) => (p & (1 << k) ? t : OPPOSITE[k])).join(', ');

export function piece(p: number): HTMLElement {
  return h('span', {
    class: 'qt-piece' + (p & 1 ? ' tall' : '') + (p & 2 ? ' dark' : '') + (p & 4 ? ' square' : '') + (p & 8 ? ' hollow' : ''),
    title: describe(p),
  });
}

export function createView(root: HTMLElement, handlers: ViewHandlers, extraHints: [string, string][] = []): DuelView {
  let state: ViewState | null = null;
  let cursor = 5; // case du plateau
  let pickCursor = 0; // case de la réserve (0..15 = numéro de pièce)
  let zone: 'board' | 'pool' = 'board';
  let placed: number | null = null; // case choisie, en attente de la pièce à donner

  const cells = Array.from({ length: 16 }, () => h('div', { class: 'qt-cell' }));
  const pool = Array.from({ length: 16 }, () => h('div', { class: 'qt-slot' }));
  const hand = h('div', { class: 'qt-hand' });
  const board = h('div', { class: 'qt-board' }, ...cells);
  const side = h('div', { class: 'qt-side' }, hand, h('div', { class: 'qt-pool' }, ...pool));
  const { legend, status, toggleRules } = boardShell(root, {
    board,
    side,
    keys: [['← ↑ → ↓', 'case'], ['Entrée', 'poser / donner'], ['Tab', 'plateau ↔ réserve'], ...extraHints],
    rules: RULES,
  });

  const myTurn = () => state !== null && state.result === null && state.me !== null && state.turn === state.me;
  const inHand = () => (state ? state.board[16] - 1 : -1);
  /** Faut-il encore donner une pièce après la pose en `cell` ? */
  const mustGive = (cell: number) => {
    const n = state!.board.slice();
    n[cell] = state!.board[16];
    return !winningLine(n) && available(n).length > 0;
  };

  const render = () => {
    if (!state) return;
    const s = state;
    const b = s.board;
    legend.replaceChildren(...legendItems(s, (p) => h('span', { class: `qt-mark p${p + 1}` })));
    const free = new Set(available(b));
    const giving = myTurn() && (b[16] === 0 || placed !== null);
    cells.forEach((el, i) => {
      const v = i === placed ? b[16] : b[i];
      el.replaceChildren(v ? piece(v - 1) : '');
      el.className =
        'qt-cell' +
        (s.line.includes(i) ? ' win' : '') +
        (i === placed ? ' ghost' : '') +
        (myTurn() && !giving && b[i] === 0 ? ' target' : '') +
        (myTurn() && zone === 'board' && i === cursor ? ' cursor' : '');
    });
    pool.forEach((el, p) => {
      el.replaceChildren(free.has(p) ? piece(p) : '');
      el.className = 'qt-slot' + (giving && free.has(p) ? ' target' : '') + (myTurn() && zone === 'pool' && p === pickCursor ? ' cursor' : '');
    });
    const held = placed === null ? inHand() : -1; // une fois posée, la pièce est sur le plateau
    const holder = s.result === null && held >= 0 ? s.names[s.turn] : null;
    hand.replaceChildren(
      h('span', { class: 'muted small' }, holder ? `À poser par ${s.me === s.turn ? 'toi' : holder}` : giving ? 'À donner' : 'Pièce à poser'),
      held >= 0 ? piece(held) : h('span', { class: 'qt-empty' }),
    );
    let text = statusText(s, myTurn());
    if (myTurn() && !s.message) {
      if (b[16] === 0) text = 'Choisis la pièce que ton adversaire va poser.';
      else if (placed !== null) text = 'Choisis maintenant la pièce à donner.';
      else text = `Pose la pièce reçue (${describe(held)}).`;
    } else if (!s.message && s.result === null && !myTurn() && b[16] === 0) text = `${s.names[s.turn]} choisit ta pièce…`;
    status.textContent = text;
  };

  const placeAt = (i: number) => {
    if (!state || state.board[i] !== 0 || state.board[16] === 0) return;
    if (!mustGive(i)) {
      placed = null;
      return handlers.play(`p${i}`);
    }
    placed = i;
    zone = 'pool';
    const free = available(state.board.map((v, k) => (k === i ? state!.board[16] : v)));
    if (!free.includes(pickCursor)) pickCursor = free[0];
    render();
  };

  const give = (p: number) => {
    if (!state || !available(state.board).includes(p)) return;
    if (state.board[16] === 0) handlers.play(`g${p}`);
    else if (placed !== null) {
      const mv = `p${placed}g${p}`;
      placed = null;
      handlers.play(mv);
    }
  };

  const activate = () => {
    if (!state) return;
    if (state.result !== null) return handlers.rematch();
    if (!myTurn()) return;
    if (state.board[16] === 0 || placed !== null) {
      if (zone === 'board' && placed !== null) {
        // Entrée sur le plateau pendant le choix : on change de case.
        if (state.board[cursor] === 0) placeAt(cursor);
        return;
      }
      return give(pickCursor);
    }
    if (zone === 'board') placeAt(cursor);
  };

  cells.forEach((el, i) => {
    el.addEventListener('mouseenter', () => {
      cursor = i;
      zone = 'board';
      render();
    });
    el.addEventListener('click', () => {
      if (state?.result !== null) return handlers.rematch();
      if (myTurn() && state.board[16] !== 0) placeAt(i);
    });
  });
  pool.forEach((el, p) => {
    el.addEventListener('mouseenter', () => {
      pickCursor = p;
      zone = 'pool';
      render();
    });
    el.addEventListener('click', () => myTurn() && give(p));
  });

  const moveCursor = (dr: number, dc: number) => {
    if (zone === 'board') {
      const r = Math.max(0, Math.min(3, Math.floor(cursor / 4) + dr));
      const c = Math.max(0, Math.min(3, (cursor % 4) + dc));
      cursor = r * 4 + c;
    } else {
      const r = Math.max(0, Math.min(3, Math.floor(pickCursor / 4) + dr));
      const c = Math.max(0, Math.min(3, (pickCursor % 4) + dc));
      pickCursor = r * 4 + c;
    }
    render();
  };

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'q' || key === 'a') moveCursor(0, -1);
    else if (key === 'arrowright' || key === 'd') moveCursor(0, 1);
    else if (key === 'arrowup' || key === 'z' || key === 'w') moveCursor(-1, 0);
    else if (key === 'arrowdown' || key === 's') moveCursor(1, 0);
    else if (key === 'tab') {
      zone = zone === 'board' ? 'pool' : 'board';
      render();
    } else if (key === 'enter' || key === ' ') activate();
    else if (key === 'i') toggleRules();
    else if (key === 'r') handlers.rematch();
    else if (key === 'backspace') {
      if (placed !== null) {
        placed = null;
        zone = 'board';
        render();
      } else handlers.exit();
    } else if (!handlers.key?.(key)) return;
    e.preventDefault();
  });

  return {
    update(next) {
      if (!state || state.history?.length !== next.history?.length || state.me !== next.me) {
        placed = null;
        // Premier coup : on commence dans la réserve ; sinon sur le plateau.
        zone = next.board[16] === 0 ? 'pool' : 'board';
      }
      state = next;
      render();
    },
    destroy: popKeys,
  };
}
