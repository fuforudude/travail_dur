import { isTyping, pushKeys } from '../../core/input';
import { h, hints } from '../../ui/dom';
import { statusText, type DuelView, type ViewHandlers, type ViewState } from '../duel';
import { COLS, ROWS } from './logic';

export function createView(root: HTMLElement, handlers: ViewHandlers, extraHints: [string, string][] = []): DuelView {
  let state: ViewState | null = null;
  let cursor = Math.floor(COLS / 2);

  const cells = Array.from({ length: ROWS * COLS }, (_, i) => h('div', { class: 'c4-cell', 'data-col': i % COLS }));
  const heads = Array.from({ length: COLS }, (_, c) => h('div', { class: 'c4-head', 'data-col': c }));
  const legend = h('div', { class: 'game-bar' });
  const status = h('p', { class: 'status' }, 'Chargement…');
  root.append(
    h(
      'div',
      { class: 'game' },
      legend,
      h('div', { class: 'c4' }, h('div', { class: 'c4-heads' }, ...heads), h('div', { class: 'c4-board' }, ...cells)),
      status,
      hints(['← →', 'colonne'], ['Entrée', 'jouer'], ['R', 'revanche'], ...extraHints, ['Retour arrière', 'quitter']),
    ),
  );

  const myTurn = () => state !== null && state.result === null && state.me !== null && state.turn === state.me;

  const render = () => {
    if (!state) return;
    const s = state;
    legend.replaceChildren(
      ...[0, 1].map((p) =>
        h(
          'span',
          { class: 'stat' + (s.result === null && s.turn === p ? ' active' : '') },
          h('span', { class: `disc p${p + 1}` }),
          ' ',
          s.me === p ? `${s.names[p]} (toi)` : s.names[p],
          ' ',
          h('b', {}, String(s.scores[p])),
        ),
      ),
    );
    s.board.forEach((v, i) => {
      cells[i].className = 'c4-cell' + (v ? ` p${v}` : '') + (s.line.includes(i) ? ' win' : '') + (s.last === i ? ' last' : '');
    });
    heads.forEach((el, c) => (el.className = 'c4-head' + (myTurn() && c === cursor ? ` p${s.me! + 1}` : '')));

    status.textContent = statusText(s, myTurn());
  };

  const moveCursor = (c: number) => {
    if (Number.isNaN(c)) return;
    cursor = Math.max(0, Math.min(COLS - 1, c));
    render();
  };
  const over = () => state !== null && state.result !== null;

  const colOf = (e: Event) => Number((e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col ?? NaN);
  for (const el of [...cells, ...heads]) {
    el.addEventListener('mouseenter', (e) => moveCursor(colOf(e)));
    el.addEventListener('click', (e) => {
      if (over()) return handlers.rematch();
      moveCursor(colOf(e));
      if (myTurn()) handlers.play(cursor);
    });
  }

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'q' || key === 'a') moveCursor(cursor - 1);
    else if (key === 'arrowright' || key === 'd') moveCursor(cursor + 1);
    else if (key === 'enter' || key === ' ' || key === 'arrowdown' || key === 's') {
      if (over()) {
        if (key === 'enter' || key === ' ') handlers.rematch();
      } else if (myTurn()) handlers.play(cursor);
    } else if (key === 'r') handlers.rematch();
    else if (key === 'backspace') handlers.exit();
    else if (!handlers.key?.(key)) return;
    e.preventDefault();
  });

  return {
    update(next: ViewState) {
      state = next;
      render();
    },
    destroy: popKeys,
  };
}
