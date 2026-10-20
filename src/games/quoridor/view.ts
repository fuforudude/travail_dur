import { isTyping, pushKeys } from '../../core/input';
import { h } from '../../ui/dom';
import { boardShell, legendItems, type Side } from '../board';
import { statusText, type DuelView, type ViewHandlers, type ViewState } from '../duel';
import { N, pawnMoves, wallAt, wallLegal } from './logic';

export const RULES = [
  'Chaque joueur a un pion et 10 murs. Le premier qui amène son pion sur la ligne opposée gagne.',
  'À son tour, on fait l’un ou l’autre : avancer son pion d’une case (pas en diagonale), ou poser un mur. Un mur mesure deux cases et bloque le passage entre elles.',
  'Les murs ne peuvent ni se chevaucher ni se croiser, et il doit toujours rester un chemin vers l’arrivée pour chacun des deux pions : on ralentit l’adversaire, on ne l’enferme pas.',
  'Si les deux pions sont face à face, on peut sauter par-dessus l’adversaire. Si un mur ou le bord empêche le saut tout droit, on saute en diagonale, à gauche ou à droite de lui.',
  'Clavier : flèches pour bouger le curseur, Entrée pour aller sur la case marquée. M passe en mode mur (le curseur vise une intersection), Espace tourne le mur, Entrée le pose. À la souris : on clique une case, ou on pose un mur en cliquant entre deux cases.',
];

type Wall = { r: number; c: number; o: 1 | 2 };

export function createView(root: HTMLElement, handlers: ViewHandlers, extraHints: [string, string][] = []): DuelView {
  let state: ViewState | null = null;
  let cursor = 4 * N + 4; // case affichée
  let wallMode = false;
  let orient: 1 | 2 = 1;
  let wallCursor = 3 * 8 + 3; // intersection affichée
  let hover: Wall | null = null; // mur survolé à la souris (coordonnées réelles)

  const grid = h('div', { class: 'qd' });
  const cells: HTMLElement[] = [];
  // Grille de 17 pistes : cases sur les pistes paires, couloirs (murs) sur les impaires.
  for (let v = 0; v < N * N; v++) {
    const el = h('div', { class: 'qd-cell' });
    el.style.gridArea = `${2 * Math.floor(v / N) + 1} / ${2 * (v % N) + 1}`;
    cells.push(el);
    grid.append(el);
  }
  const hits: { el: HTMLElement; r: number; c: number; o: 1 | 2 }[] = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < N; c++) {
      // Couloir horizontal sous la case (r, c), et couloir vertical à droite de la case (c, r).
      hits.push({ el: h('div', { class: 'qd-hit' }), r, c, o: 1 });
      hits.push({ el: h('div', { class: 'qd-hit' }), r: c, c: r, o: 2 });
    }
  for (const x of hits) {
    x.el.style.gridArea = x.o === 1 ? `${2 * x.r + 2} / ${2 * x.c + 1}` : `${2 * x.r + 1} / ${2 * x.c + 2}`;
    grid.append(x.el);
  }
  const walls = h('div', { class: 'qd-walls' });
  grid.append(walls);
  const side = h('div', { class: 'qd-side' });

  const { legend, status, toggleRules } = boardShell(root, {
    board: grid,
    side,
    keys: [['← ↑ → ↓', 'case'], ['Entrée', 'jouer'], ['M', 'mode mur'], ['Espace', 'tourner'], ...extraHints],
    rules: RULES,
  });

  const mySide = (): Side | null => (state && state.me !== null ? ((state.me + 1) as Side) : null);
  const flipped = () => state?.me === 1;
  const realCell = (v: number) => (flipped() ? N * N - 1 - v : v);
  /** Mur réel visé par l'intersection affichée (r, c). */
  const realWall = (r: number, c: number, o: 1 | 2): Wall => (flipped() ? { r: 7 - r, c: 7 - c, o } : { r, c, o });
  const myTurn = () => state !== null && state.result === null && state.me !== null && state.turn === state.me;
  const wallMove = (w: Wall) => `${w.o === 1 ? 'h' : 'v'}${w.r}${w.c}`;

  const preview = (): Wall | null => {
    if (!myTurn()) return null;
    if (hover) return hover;
    if (!wallMode) return null;
    return realWall(Math.floor(wallCursor / 8), wallCursor % 8, orient);
  };

  /** Élément mur placé sur la grille, aux coordonnées affichées. */
  const wallEl = (w: Wall, cls: string) => {
    const r = flipped() ? 7 - w.r : w.r;
    const c = flipped() ? 7 - w.c : w.c;
    const el = h('div', { class: `qd-wall ${cls}` });
    el.style.gridArea = w.o === 1 ? `${2 * r + 2} / ${2 * c + 1} / span 1 / span 3` : `${2 * r + 1} / ${2 * c + 2} / span 3 / span 1`;
    return el;
  };

  const render = () => {
    if (!state) return;
    const s = state;
    const b = s.board;
    legend.replaceChildren(...legendItems(s, (p) => h('span', { class: `qd-mark p${p + 1}` })));
    const me = mySide();
    const targets = new Set(myTurn() && !wallMode ? pawnMoves(b, me!) : []);
    cells.forEach((el, v) => {
      const i = realCell(v);
      el.replaceChildren(i === b[0] ? h('span', { class: 'qd-pawn p1' }) : i === b[1] ? h('span', { class: 'qd-pawn p2' }) : '');
      el.className = 'qd-cell' + (targets.has(i) ? ' target' : '') + (myTurn() && !wallMode && v === cursor ? ' cursor' : '');
    });
    // Rangées d'arrivée : celle de chaque camp, colorée discrètement.
    const goalTop = flipped() ? 2 : 1;
    cells.forEach((el, v) => {
      if (v < N) el.classList.add(`goal${goalTop}`);
      if (v >= N * (N - 1)) el.classList.add(`goal${3 - goalTop}`);
    });
    const placed: HTMLElement[] = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (wallAt(b, r, c)) placed.push(wallEl({ r, c, o: wallAt(b, r, c) as 1 | 2 }, 'set'));
    const p = preview();
    if (p) placed.push(wallEl(p, wallLegal(b, me!, p.r, p.c, p.o) ? 'ghost' : 'ghost bad'));
    walls.replaceChildren(...placed);
    side.replaceChildren(
      ...[1, 2].map((x) =>
        h('div', { class: 'qd-stock' }, h('span', { class: `qd-mark p${x}` }), ' ', h('b', {}, String(b[1 + x])), ' murs'),
      ),
    );
    let text = statusText(s, myTurn());
    if (myTurn() && !s.message) text += wallMode ? ' Mode mur : Espace pour tourner, M pour revenir au pion.' : '';
    status.textContent = text;
  };

  const play = (mv: string) => {
    hover = null;
    handlers.play(mv);
  };

  const activate = () => {
    if (!state) return;
    if (state.result !== null) return handlers.rematch();
    if (!myTurn()) return;
    const me = mySide()!;
    if (wallMode) {
      const w = preview()!;
      if (wallLegal(state.board, me, w.r, w.c, w.o)) play(wallMove(w));
      return;
    }
    const i = realCell(cursor);
    if (pawnMoves(state.board, me).includes(i)) play(`m${i}`);
  };

  cells.forEach((el, v) => {
    el.addEventListener('mouseenter', () => {
      cursor = v;
      hover = null;
      render();
    });
    el.addEventListener('click', () => {
      if (state?.result !== null) return handlers.rematch();
      if (!myTurn()) return;
      const i = realCell(v);
      if (pawnMoves(state.board, mySide()!).includes(i)) play(`m${i}`);
    });
  });
  // Couloirs : survol = aperçu du mur, clic = pose. Un mur couvre ce couloir et le suivant.
  for (const x of hits) {
    const target = (): Wall => {
      const r = Math.min(x.r, 7);
      const c = Math.min(x.c, 7);
      return realWall(r, c, x.o);
    };
    x.el.addEventListener('mouseenter', () => {
      hover = target();
      render();
    });
    x.el.addEventListener('mouseleave', () => {
      hover = null;
      render();
    });
    x.el.addEventListener('click', () => {
      if (!myTurn()) return;
      const w = target();
      if (wallLegal(state!.board, mySide()!, w.r, w.c, w.o)) play(wallMove(w));
    });
  }

  const moveCursor = (dr: number, dc: number) => {
    if (wallMode) {
      const r = Math.max(0, Math.min(7, Math.floor(wallCursor / 8) + dr));
      const c = Math.max(0, Math.min(7, (wallCursor % 8) + dc));
      wallCursor = r * 8 + c;
    } else {
      const r = Math.max(0, Math.min(N - 1, Math.floor(cursor / N) + dr));
      const c = Math.max(0, Math.min(N - 1, (cursor % N) + dc));
      cursor = r * N + c;
    }
    hover = null;
    render();
  };

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'q' || key === 'a') moveCursor(0, -1);
    else if (key === 'arrowright' || key === 'd') moveCursor(0, 1);
    else if (key === 'arrowup' || key === 'z' || key === 'w') moveCursor(-1, 0);
    else if (key === 'arrowdown' || key === 's') moveCursor(1, 0);
    else if (key === 'm') {
      wallMode = !wallMode;
      hover = null;
      render();
    } else if (key === ' ' && wallMode) {
      orient = orient === 1 ? 2 : 1;
      render();
    } else if (key === 'enter' || key === ' ') activate();
    else if (key === 'i') toggleRules();
    else if (key === 'r') handlers.rematch();
    else if (key === 'backspace') {
      if (wallMode) {
        wallMode = false;
        render();
      } else handlers.exit();
    } else if (!handlers.key?.(key)) return;
    e.preventDefault();
  });

  return {
    update(next) {
      if (!state || state.me !== next.me) {
        cursor = 7 * N + 4; // devant mon pion
        wallMode = false;
      }
      if (state && state.history?.length !== next.history?.length) wallMode = false;
      state = next;
      render();
    },
    destroy: popKeys,
  };
}
