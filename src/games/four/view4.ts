// Jeux à 4 : affichage commun (joueurs, état, boutons) et dessin des deux plateaux sur un canvas,
// tourné pour que le joueur voie toujours sa couleur en bas.

import { blip } from '../../core/sound';
import { h } from '../../ui/dom';
import * as chess from './engine/chess4';
import * as quoridor from './engine/quoridor4';
import { type Seat } from './engine/types';

export const COLORS = ['#d9473f', '#3f7fd9', '#e0b52c', '#3fae6a'];
export const COLOR_NAMES = ['Rouge', 'Bleu', 'Jaune', 'Vert'];
const GREY = '#9aa0ae';

export interface SeatInfo {
  name: string;
  bot: boolean;
}

export interface View4State {
  game: 'chess4' | 'quoridor4';
  board: number[];
  turn: Seat | null; // null : partie terminée
  me: Seat | null; // null : spectateur
  seats: SeatInfo[];
  winner: Seat | null;
  draw: boolean;
  last: string | null; // dernier coup joué
  waiting?: boolean; // coup envoyé, réponse du serveur attendue
  note?: string; // message ponctuel (erreur du serveur…)
}

export interface View4Handlers {
  play(mv: string): void;
  resign?(): void;
  rematch?(): void;
  exit(): void;
}

const alive = (s: View4State, seat: Seat) => (s.game === 'chess4' ? chess.alive(s.board, seat) : quoridor.alive(s.board, seat));
const legalMoves = (s: View4State) =>
  s.me === null || s.turn !== s.me || s.waiting ? [] : s.game === 'chess4' ? chess.moves(s.board, s.me) : quoridor.moves(s.board, s.me);

export function createView4(root: HTMLElement, handlers: View4Handlers) {
  let state: View4State | null = null;
  let selected: number | null = null; // échecs : case de la pièce choisie
  let mode: 'move' | 'h' | 'v' = 'move'; // corridor : déplacer ou poser un mur
  let hover: { x: number; y: number } | null = null;

  const canvas = h('canvas', { class: 'f4-board' });
  const g = canvas.getContext('2d')!;
  const players = h('ol', { class: 'f4-players' });
  const status = h('p', { class: 'status f4-status' });
  const tools = h('div', { class: 'f4-tools' });
  const actions = h('div', { class: 'f4-actions' });
  const wrap = h('div', { class: 'game f4' }, h('div', { class: 'f4-main' }, canvas, h('div', { class: 'f4-side' }, players, tools, status, actions)));
  root.append(wrap);
  const wasWide = root.classList.contains('wide');
  root.classList.add('wide'); // plateau et panneau des joueurs côte à côte

  // --- Géométrie : taille d'une case, rotation selon le joueur
  const size = () => (state?.game === 'chess4' ? chess.N : quoridor.N);
  let px = 0; // taille d'une case en pixels CSS
  const resize = () => {
    const width = root.clientWidth || 600;
    // Le panneau des joueurs (≈ 260 px) va à droite du plateau quand il y a la place, sinon dessous.
    const avail = Math.min(width >= 720 ? width - 280 : width, 680, Math.max(320, window.innerHeight - 130));
    px = Math.max(18, Math.floor(avail / size()));
    const ratio = window.devicePixelRatio || 1;
    canvas.width = px * size() * ratio;
    canvas.height = px * size() * ratio;
    canvas.style.width = `${px * size()}px`;
    canvas.style.height = `${px * size()}px`;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  /** Quarts de tour pour amener le joueur en bas. */
  const turns = () => (4 - (state?.me ?? 0)) % 4; // bas 0, gauche 3 (sens horaire), haut 2, droite 1
  /** Case réelle (ligne, colonne) → position affichée, et inversement. */
  const rot = (r: number, c: number, k: number, n: number): [number, number] => {
    for (let i = 0; i < ((k % 4) + 4) % 4; i++) [r, c] = [c, n - 1 - r]; // un quart de tour dans le sens horaire
    return [r, c];
  };
  const toScreen = (r: number, c: number) => rot(r, c, turns(), size());
  const toReal = (r: number, c: number) => rot(r, c, 4 - turns(), size());

  // --- Dessin
  const draw = () => {
    if (!state) return;
    const s = state;
    const n = size();
    const W = px * n;
    g.clearRect(0, 0, W, W);
    const legal = legalMoves(s);
    if (s.game === 'chess4') drawChess(s, legal, n);
    else drawQuoridor(s, legal, n);
  };

  const cellRect = (r: number, c: number) => {
    const [y, x] = toScreen(r, c);
    return { x: x * px, y: y * px };
  };

  const drawChess = (s: View4State, legal: string[], n: number) => {
    const b = s.board;
    const lastMove = s.last ? chess.parse(s.last) : null;
    const targets = new Set(selected === null ? [] : legal.map((m) => chess.parse(m)!).filter((m) => m.from === selected).map((m) => m.to));
    const checked = new Set<number>();
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      if (!chess.alive(b, seat) || !chess.inCheck(b, seat)) continue;
      checked.add(b.findIndex((v, i) => i < 196 && v === (seat + 1) * 10 + chess.KING));
    }
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        if (!chess.valid(r, c)) continue;
        const cell = r * n + c;
        const { x, y } = cellRect(r, c);
        g.fillStyle = (r + c) % 2 ? '#b9c3d6' : '#e9edf5';
        if (lastMove && (cell === lastMove.from || cell === lastMove.to)) g.fillStyle = '#f0e38a';
        if (cell === selected) g.fillStyle = '#9fd38f';
        if (checked.has(cell)) g.fillStyle = '#f2a39c';
        g.fillRect(x, y, px, px);
        const v = b[cell];
        if (v) {
          const owner = chess.ownerOf(v);
          g.font = `${Math.round(px * 0.8)}px "Segoe UI Symbol", "Noto Sans Symbols 2", sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.lineWidth = Math.max(1, px * 0.06);
          g.strokeStyle = '#1f2330';
          g.fillStyle = owner === chess.DEAD ? GREY : COLORS[owner - 1];
          const glyph = ['', '♟', '♞', '♝', '♜', '♛', '♚'][chess.typeOf(v)] + '︎';
          g.strokeText(glyph, x + px / 2, y + px / 2 + px * 0.04);
          g.fillText(glyph, x + px / 2, y + px / 2 + px * 0.04);
        }
        if (targets.has(cell)) {
          g.fillStyle = 'rgba(31, 35, 48, 0.35)';
          g.beginPath();
          g.arc(x + px / 2, y + px / 2, v ? px * 0.45 : px * 0.15, 0, Math.PI * 2);
          if (v) {
            g.strokeStyle = 'rgba(31, 35, 48, 0.5)';
            g.lineWidth = 3;
            g.stroke();
          } else g.fill();
        }
      }
  };

  const drawQuoridor = (s: View4State, legal: string[], n: number) => {
    const b = s.board;
    // Cases, avec la case d'arrivée de chaque joueur teintée de sa couleur.
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const { x, y } = cellRect(r, c);
        g.fillStyle = '#e9edf5';
        for (const seat of [0, 1, 2, 3] as Seat[]) if (quoridor.atGoal(seat, r * n + c) && alive(s, seat)) g.fillStyle = COLORS[seat] + '30';
        g.fillRect(x + 2, y + 2, px - 4, px - 4);
      }
    // Cases où le pion peut aller.
    if (mode === 'move')
      for (const mv of legal)
        if (mv[0] === 'm') {
          const cell = Number(mv.slice(1));
          const { x, y } = cellRect(Math.floor(cell / n), cell % n);
          g.fillStyle = 'rgba(31, 35, 48, 0.25)';
          g.beginPath();
          g.arc(x + px / 2, y + px / 2, px * 0.15, 0, Math.PI * 2);
          g.fill();
        }
    // Pions.
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const cell = b[seat];
      if (cell < 0) continue;
      const { x, y } = cellRect(Math.floor(cell / n), cell % n);
      g.fillStyle = COLORS[seat];
      g.strokeStyle = '#1f2330';
      g.lineWidth = seat === s.turn ? 3 : 1.5;
      g.beginPath();
      g.arc(x + px / 2, y + px / 2, px * 0.32, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // Murs posés, puis l'aperçu du mur sous la souris.
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (quoridor.wallAt(b, r, c)) drawWall(r, c, quoridor.wallAt(b, r, c) as 1 | 2, '#5b4636');
    const wall = hoverWall();
    if (wall) drawWall(wall.r, wall.c, wall.o, legal.includes(wall.mv) ? '#5b463699' : '#c8343c66');
  };

  /** Mur à l'intersection (r, c) : entre les lignes r et r+1 (horizontal) ou les colonnes c et c+1. */
  const drawWall = (r: number, c: number, o: 1 | 2, color: string) => {
    const n = quoridor.N;
    // Les deux extrémités du mur en coordonnées réelles (unités de case), puis tournées.
    const pts: [number, number][] = o === 1 ? [[r + 1, c], [r + 1, c + 2]] : [[r, c + 1], [r + 2, c + 1]];
    const screen = pts.map(([yr, xc]) => {
      // rotation d'un point de grille (pas d'une case) : n au lieu de n - 1
      let [y, x] = [yr, xc];
      for (let i = 0; i < turns(); i++) [y, x] = [x, n - y];
      return [x * px, y * px];
    });
    g.strokeStyle = color;
    g.lineWidth = Math.max(4, px * 0.16);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(screen[0][0], screen[0][1]);
    g.lineTo(screen[1][0], screen[1][1]);
    g.stroke();
  };

  /** Mur visé par la souris, en mode mur : l'intersection la plus proche. */
  const hoverWall = () => {
    if (!hover || mode === 'move' || state?.game !== 'quoridor4') return null;
    const n = quoridor.N;
    // Point de grille le plus proche, ramené en coordonnées réelles.
    let gy = Math.round(hover.y / px);
    let gx = Math.round(hover.x / px);
    for (let i = 0; i < 4 - turns(); i++) [gy, gx] = [gx, n - gy];
    // Orientation à l'écran → orientation réelle (un quart de tour échange horizontal et vertical).
    let o: 1 | 2 = mode === 'h' ? 1 : 2;
    if (turns() % 2) o = o === 1 ? 2 : 1;
    const r = gy - 1;
    const c = gx - 1;
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    return { r, c, o, mv: `${o === 1 ? 'h' : 'v'}${r}${c}` };
  };

  // --- Clics
  const cellAt = (e: MouseEvent): [number, number] | null => {
    const rect = canvas.getBoundingClientRect();
    const sy = Math.floor((e.clientY - rect.top) / px);
    const sx = Math.floor((e.clientX - rect.left) / px);
    if (sx < 0 || sy < 0 || sx >= size() || sy >= size()) return null;
    return toReal(sy, sx);
  };

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (mode !== 'move') draw();
  });
  canvas.addEventListener('mouseleave', () => {
    hover = null;
    draw();
  });
  canvas.addEventListener('click', (e) => {
    if (!state) return;
    const legal = legalMoves(state);
    if (!legal.length) return;
    const n = size();
    if (state.game === 'quoridor4') {
      if (mode !== 'move') {
        const rect = canvas.getBoundingClientRect();
        hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const w = hoverWall();
        if (w && legal.includes(w.mv)) return send(w.mv);
        return blip(180, 0.05);
      }
      const at = cellAt(e);
      if (at && legal.includes(`m${at[0] * n + at[1]}`)) return send(`m${at[0] * n + at[1]}`);
      return blip(180, 0.05);
    }
    const at = cellAt(e);
    if (!at) return;
    const cell = at[0] * n + at[1];
    const mine = legal.map((m) => chess.parse(m)!);
    if (selected !== null && mine.some((m) => m.from === selected && m.to === cell)) return send(`${selected}-${cell}`);
    selected = mine.some((m) => m.from === cell) ? cell : null;
    blip(selected === null ? 180 : 520, 0.03);
    draw();
  });

  const send = (mv: string) => {
    selected = null;
    mode = 'move';
    blip(440, 0.04);
    handlers.play(mv);
  };

  // --- Panneau
  const button = (label: string, run: () => void, main = false) => {
    const b = h('button', { class: `field${main ? ' rl-spin' : ''}`, type: 'button' }, label);
    b.addEventListener('click', run);
    return b;
  };

  const renderSide = () => {
    if (!state) return;
    const s = state;
    players.replaceChildren(
      ...s.seats.map((p, i) => {
        const seat = i as Seat;
        const out = !alive(s, seat);
        return h(
          'li',
          { class: `f4-player${seat === s.turn ? ' on' : ''}${out ? ' out' : ''}` },
          h('span', { class: 'f4-dot', style: `background:${COLORS[seat]}` }),
          h('span', { class: 'f4-name' }, p.name, seat === s.me ? ' (toi)' : ''),
          h('span', { class: 'muted small' }, out ? 'éliminé' : s.game === 'quoridor4' ? `${s.board[4 + seat]} murs` : ''),
        );
      }),
    );
    const myTurn = s.me !== null && s.turn === s.me && !s.waiting;
    tools.replaceChildren();
    if (s.game === 'quoridor4' && myTurn && s.board[4 + s.me!] > 0) {
      const tool = (m: typeof mode, label: string) => {
        const b = h('button', { class: `chip${mode === m ? ' on' : ''}`, type: 'button' }, label);
        b.addEventListener('click', () => {
          mode = m;
          renderSide();
          draw();
        });
        return b;
      };
      tools.append(tool('move', 'Déplacer'), tool('h', 'Mur ─'), tool('v', 'Mur │'));
    }
    if (s.note) status.textContent = s.note;
    else if (s.turn === null) {
      status.textContent = s.draw ? 'Partie nulle.' : s.winner === s.me ? 'Tu as gagné !' : `${s.seats[s.winner!]?.name ?? '?'} gagne.`;
    } else if (s.me !== null && !alive(s, s.me)) status.textContent = 'Tu es éliminé.';
    else if (myTurn) status.textContent = legalMoves(s)[0] === 'pass' ? 'Bloqué : tu passes ton tour.' : 'À toi de jouer.';
    else status.textContent = `${s.seats[s.turn].name} réfléchit…`;
    actions.replaceChildren(
      ...(s.turn !== null && s.me !== null && alive(s, s.me) && handlers.resign ? [button('Abandonner', handlers.resign)] : []),
      ...(s.turn === null && handlers.rematch ? [button('Revanche', handlers.rematch, true)] : []),
      button('Quitter', handlers.exit),
    );
    // Bloqué au corridor : on passe tout seul.
    if (myTurn && legalMoves(s)[0] === 'pass') window.setTimeout(() => state === s && handlers.play('pass'), 900);
  };

  const onResize = () => {
    resize();
    draw();
  };
  window.addEventListener('resize', onResize);

  return {
    update(s: View4State) {
      const first = !state || state.game !== s.game;
      state = s;
      if (s.turn !== s.me) selected = null;
      if (first) resize();
      renderSide();
      draw();
      if (first) requestAnimationFrame(onResize); // taille réelle une fois la page posée
    },
    destroy() {
      window.removeEventListener('resize', onResize);
      if (!wasWide) root.classList.remove('wide');
      wrap.remove();
    },
  };
}
