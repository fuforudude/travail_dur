import { isTyping, pushKeys } from '../../core/input';
import { applySkins, tttGlyphs } from '../../net/cosmetics';
import { touchPad } from '../../core/touch';
import { h, hints } from '../../ui/dom';
import { playerName } from '../board';
import { statusText, type DuelView, type ViewHandlers, type ViewState } from '../duel';


export function createView(root: HTMLElement, handlers: ViewHandlers, extraHints: [string, string][] = []): DuelView {
  let state: ViewState | null = null;
  let cursor = 4; // case du milieu

  const cells = Array.from({ length: 9 }, (_, i) => h('div', { class: 'ttt-cell', 'data-i': i }));
  const legend = h('div', { class: 'game-bar' });
  const status = h('p', { class: 'status' }, 'Chargement…');
  const game = h(
    'div',
    { class: 'game' },
    legend,
    h('div', { class: 'ttt' }, ...cells),
    status,
    touchPad([{ label: 'Revanche', key: 'r' }]),
    hints(['← ↑ → ↓', 'case'], ['Entrée', 'jouer'], ['R', 'revanche'], ...extraHints, ['Retour arrière', 'quitter']),
  );
  root.append(game);

  const myTurn = () => state !== null && state.result === null && state.me !== null && state.turn === state.me;
  const over = () => state !== null && state.result !== null;

  const render = () => {
    if (!state) return;
    const s = state;
    applySkins(game, 'tictactoe', s.ids);
    const MARKS = ['', ...tttGlyphs(s.ids)];
    legend.replaceChildren(
      ...[0, 1].map((p) =>
        h(
          'span',
          { class: 'stat' + (s.result === null && s.turn === p ? ' active' : '') },
          h('span', { class: `mark p${p + 1}` }, MARKS[p + 1]),
          ' ',
          playerName(s, p as 0 | 1),
          ' ',
          h('b', {}, String(s.scores[p])),
        ),
      ),
    );
    s.board.forEach((v, i) => {
      const c = cells[i];
      c.textContent = MARKS[v] ?? '';
      c.className =
        'ttt-cell' +
        (v ? ` p${v}` : '') +
        (s.line.includes(i) ? ' win' : '') +
        (s.last === i ? ' last' : '') +
        (i === cursor && myTurn() ? ' cursor' : '');
    });
    status.textContent = statusText(s, myTurn());
  };

  const moveCursor = (dx: number, dy: number) => {
    const x = (cursor % 3) + dx;
    const y = Math.floor(cursor / 3) + dy;
    cursor = Math.max(0, Math.min(2, y)) * 3 + Math.max(0, Math.min(2, x));
    render();
  };

  const tryPlay = (i: number) => {
    if (over()) return handlers.rematch();
    if (myTurn() && state!.board[i] === 0) handlers.play(i);
  };

  cells.forEach((c, i) => {
    c.addEventListener('mouseenter', () => {
      cursor = i;
      render();
    });
    c.addEventListener('click', () => tryPlay(i));
  });

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'q' || key === 'a') moveCursor(-1, 0);
    else if (key === 'arrowright' || key === 'd') moveCursor(1, 0);
    else if (key === 'arrowup' || key === 'z' || key === 'w') moveCursor(0, -1);
    else if (key === 'arrowdown' || key === 's') moveCursor(0, 1);
    else if (key >= '1' && key <= '9') tryPlay(Number(key) - 1); // pavé : 1 à 9 ligne par ligne
    else if (key === 'enter' || key === ' ') tryPlay(cursor);
    else if (key === 'r') handlers.rematch();
    else if (key === 'backspace') handlers.exit();
    else if (!handlers.key?.(key)) return;
    e.preventDefault();
  });

  return {
    update(next) {
      state = next;
      render();
    },
    destroy: popKeys,
  };
}
