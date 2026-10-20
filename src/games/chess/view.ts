import { isTyping, pushKeys } from '../../core/input';
import { applySkins } from '../../net/cosmetics';
import { h } from '../../ui/dom';
import { boardShell, legendItems, type Side } from '../board';
import { statusText, type DuelView, type ViewHandlers, type ViewState } from '../duel';
import { colorOf, inCheck, KING, moves, parseSquare, squareName, typeOf } from './logic';

// Glyphes pleins pour les deux camps (la couleur vient du CSS) ; ︎ force le rendu texte, pas emoji.
const GLYPH = ['', '♟', '♞', '♝', '♜', '♛', '♚'].map((g) => (g ? g + '︎' : ''));
const PROMOTIONS: [string, string, number][] = [
  ['q', 'D', 5],
  ['r', 'T', 4],
  ['b', 'F', 3],
  ['n', 'C', 2],
];

export const RULES = [
  'Chaque camp a un roi, une dame, deux tours, deux fous, deux cavaliers et huit pions. Les blancs commencent. Le but : mettre le roi adverse en échec et mat, c’est-à-dire l’attaquer sans qu’il puisse s’échapper.',
  'Le roi avance d’une case dans toutes les directions. La dame va en ligne droite ou en diagonale, aussi loin qu’elle veut. La tour va en ligne droite, le fou en diagonale. Le cavalier saute en L (deux cases puis une sur le côté), par-dessus les autres pièces.',
  'Le pion avance tout droit d’une case (deux depuis sa case de départ) et prend en diagonale vers l’avant. Arrivé au bout, il devient une dame, une tour, un fou ou un cavalier. Prise en passant : un pion qui avance de deux cases peut être pris comme s’il n’avançait que d’une, au coup suivant uniquement.',
  'Roque : si le roi et la tour n’ont pas encore bougé, que rien n’est entre eux et que le roi n’est ni en échec ni ne traverse une case attaquée, le roi va de deux cases vers la tour, qui passe de l’autre côté.',
  'Partie nulle : pat (aucun coup possible sans être en échec), triple répétition de la même position, 50 coups sans prise ni mouvement de pion, ou matériel insuffisant pour mater.',
  'Clavier : flèches pour bouger le curseur, Entrée pour choisir une pièce puis sa case d’arrivée (Entrée à nouveau sur la pièce pour l’annuler). Promotion : D, T, F ou C. Les coups possibles sont marqués d’un point.',
];

export function createView(root: HTMLElement, handlers: ViewHandlers, extraHints: [string, string][] = []): DuelView {
  let state: ViewState | null = null;
  let cursor = parseSquare('e2'); // index réel 0..63
  let selected: number | null = null;
  let promo: string[] | null = null; // coups de promotion en attente du choix de la pièce

  const cells = Array.from({ length: 64 }, (_, v) => h('div', { class: 'ch-sq', 'data-v': v }));
  const board = h('div', { class: 'chess' }, ...cells);
  const picker = h('div', { class: 'ch-promo', hidden: true });
  const { game, legend, status, toggleRules } = boardShell(root, {
    board,
    side: picker,
    keys: [['← ↑ → ↓', 'case'], ['Entrée', 'choisir / jouer'], ...extraHints],
    rules: RULES,
  });

  const mySide = (): Side | null => (state && state.me !== null ? ((state.me + 1) as Side) : null);
  const flipped = () => state?.me === 1;
  const toReal = (v: number) => (flipped() ? 63 - v : v);
  const myTurn = () => state !== null && state.result === null && state.me !== null && state.turn === state.me;
  const legal = () => (myTurn() ? moves(state!.board, mySide()!) : []);

  const render = () => {
    if (!state) return;
    const s = state;
    const b = s.board;
    applySkins(game, 'chess', s.ids);
    legend.replaceChildren(...legendItems(s, (p) => h('span', { class: `ch-mark ch-${p === 0 ? 'w' : 'b'}` }, GLYPH[KING])));
    const all = legal();
    const targets = new Set(selected === null ? [] : all.filter((m) => parseSquare(m) === selected).map((m) => parseSquare(m.slice(2, 4))));
    const last = s.history?.at(-1);
    const lastSquares = last ? [parseSquare(last), parseSquare(last.slice(2, 4))] : [];
    const turnSide = (s.turn + 1) as Side;
    const checked = s.result === null && inCheck(b, turnSide) ? b.indexOf(turnSide === 1 ? KING : KING + 6) : -1;
    cells.forEach((el, v) => {
      const i = toReal(v);
      const p = b[i];
      const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
      el.textContent = GLYPH[typeOf(p)];
      el.className =
        'ch-sq' +
        (dark ? ' dark' : '') +
        (p ? (colorOf(p) === 1 ? ' w' : ' b') : '') +
        (lastSquares.includes(i) ? ' last' : '') +
        (i === selected ? ' sel' : '') +
        (targets.has(i) ? (p ? ' target cap' : ' target') : '') +
        (i === checked ? ' check' : '') +
        (myTurn() && i === cursor ? ' cursor' : '');
      el.title = squareName(i);
    });
    picker.hidden = !promo;
    let text = statusText(s, myTurn());
    if (!s.message && s.result === null && checked >= 0) text = 'Échec ! ' + text;
    if (promo) text = 'Promotion : D dame, T tour, F fou, C cavalier.';
    status.textContent = text;
  };

  const choosePromotion = (letter: string) => {
    const mv = promo?.find((m) => m.endsWith(letter));
    if (!mv) return;
    promo = null;
    selected = null;
    handlers.play(mv);
    render();
  };
  picker.append(
    ...PROMOTIONS.map(([letter, key, type]) => {
      const b = h('button', { class: 'ch-promo-btn', type: 'button', title: key }, GLYPH[type]);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => choosePromotion(letter));
      return b;
    }),
  );

  const activate = (i: number) => {
    if (!state) return;
    if (state.result !== null) return handlers.rematch();
    if (!myTurn() || promo) return;
    const all = legal();
    if (selected !== null) {
      const chosen = all.filter((m) => parseSquare(m) === selected && parseSquare(m.slice(2, 4)) === i);
      if (chosen.length === 1) {
        selected = null;
        handlers.play(chosen[0]);
        return render();
      }
      if (chosen.length > 1) {
        promo = chosen;
        return render();
      }
      if (i === selected) {
        selected = null;
        return render();
      }
    }
    selected = all.some((m) => parseSquare(m) === i) ? i : null;
    render();
  };

  cells.forEach((el, v) => {
    el.addEventListener('mouseenter', () => {
      cursor = toReal(v);
      render();
    });
    el.addEventListener('click', () => activate(toReal(v)));
  });

  const moveCursor = (dr: number, dc: number) => {
    // Le curseur suit l'écran : on se déplace dans les coordonnées affichées.
    const v = flipped() ? 63 - cursor : cursor;
    const r = Math.max(0, Math.min(7, Math.floor(v / 8) + dr));
    const c = Math.max(0, Math.min(7, (v % 8) + dc));
    cursor = toReal(r * 8 + c);
    render();
  };

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (promo && 'dtfc'.includes(key) && key.length === 1) choosePromotion(PROMOTIONS['dtfc'.indexOf(key)][0]);
    else if (key === 'arrowleft' || key === 'q' || key === 'a') moveCursor(0, -1);
    else if (key === 'arrowright' || key === 'd') moveCursor(0, 1);
    else if (key === 'arrowup' || key === 'z' || key === 'w') moveCursor(-1, 0);
    else if (key === 'arrowdown' || key === 's') moveCursor(1, 0);
    else if (key === 'enter' || key === ' ') activate(cursor);
    else if (key === 'i') toggleRules();
    else if (key === 'r') handlers.rematch();
    else if (key === 'backspace') {
      if (promo || selected !== null) {
        promo = null;
        selected = null;
        render();
      } else handlers.exit();
    } else if (!handlers.key?.(key)) return;
    e.preventDefault();
  });

  return {
    update(next) {
      const fresh = !state || state.history?.length !== next.history?.length || state.me !== next.me;
      if (fresh) {
        selected = null;
        promo = null;
      }
      if (!state || state.me !== next.me) cursor = parseSquare(next.me === 1 ? 'e7' : 'e2');
      state = next;
      render();
    },
    destroy: popKeys,
  };
}
