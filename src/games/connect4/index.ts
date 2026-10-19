import { isTyping, pushKeys } from '../../core/input';
import { isPanicked, onPanicChange } from '../../core/panic';
import { blip } from '../../core/sound';
import { h, hints } from '../../ui/dom';
import type { Game, GameContext } from '../types';
import { aiMove, COLS, drop, emptyBoard, findWin, isFull, ROWS, type Board } from './logic';

const AI_ID = 'ia';

/** État complet de la partie. En multi, l'hôte en est l'unique source et le diffuse après chaque coup. */
interface State {
  version: number;
  board: Board;
  players: [string, string]; // players[0] joue les 1, players[1] les 2
  names: [string, string];
  turn: 0 | 1;
  starter: 0 | 1;
  result: null | 'draw' | 0 | 1;
  line: number[];
  last: number | null;
  scores: [number, number];
  rematch: string[];
}

function newRound(prev: State): State {
  const starter = (1 - prev.starter) as 0 | 1;
  return { ...prev, version: prev.version + 1, board: emptyBoard(), turn: starter, starter, result: null, line: [], last: null, rematch: [] };
}

function applyMove(s: State, col: number): State | null {
  if (s.result !== null) return null;
  const r = drop(s.board, col, (s.turn + 1) as 1 | 2);
  if (!r) return null;
  const win = findWin(r.board);
  const next: State = { ...s, version: s.version + 1, board: r.board, last: r.index, turn: (1 - s.turn) as 0 | 1 };
  if (win) {
    next.result = (win.who - 1) as 0 | 1;
    next.line = win.line;
    next.scores = s.scores.slice() as [number, number];
    next.scores[next.result]++;
  } else if (isFull(r.board)) {
    next.result = 'draw';
  }
  return next;
}

function mount(ctx: GameContext): () => void {
  const { room, me } = ctx;
  const multi = ctx.mode === 'multi' && room !== undefined;
  const isHost = !multi || room.isHost;
  const offs: (() => void)[] = [];

  let state: State | null = null;
  let cursor = Math.floor(COLS / 2);

  if (isHost) {
    const ids: [string, string] = multi ? [ctx.players![0], ctx.players![1]] : [me.id, AI_ID];
    const nameOf = (id: string) => (id === AI_ID ? 'Ordinateur' : (room?.player(id)?.name ?? (id === me.id ? me.name : 'Adversaire')));
    state = {
      version: 1,
      board: emptyBoard(),
      players: ids,
      names: [nameOf(ids[0]), nameOf(ids[1])],
      turn: 0,
      starter: 0,
      result: null,
      line: [],
      last: null,
      scores: [0, 0],
      rematch: [],
    };
  }

  // --- Rendu ---
  const cells = Array.from({ length: ROWS * COLS }, (_, i) => h('div', { class: 'c4-cell', 'data-col': i % COLS }));
  const heads = Array.from({ length: COLS }, (_, c) => h('div', { class: 'c4-head', 'data-col': c }));
  const board = h('div', { class: 'c4-board' }, ...cells);
  const legend = h('div', { class: 'game-bar' });
  const status = h('p', { class: 'status' });
  ctx.root.append(
    h(
      'div',
      { class: 'game' },
      legend,
      h('div', { class: 'c4' }, h('div', { class: 'c4-heads' }, ...heads), board),
      status,
      hints(['← →', 'colonne'], ['Entrée', 'jouer'], ['R', 'revanche'], ['Retour arrière', 'quitter']),
    ),
  );

  const myIndex = (): number => (state ? state.players.indexOf(me.id) : -1);
  const myTurn = () => state !== null && state.result === null && state.turn === myIndex();

  const render = () => {
    if (!state) {
      status.textContent = 'Synchronisation avec l’hôte…';
      return;
    }
    const s = state;
    legend.replaceChildren(
      ...[0, 1].map((p) =>
        h(
          'span',
          { class: 'stat' + (s.result === null && s.turn === p ? ' active' : '') },
          h('span', { class: `disc p${p + 1}` }),
          ' ',
          s.players[p] === me.id ? `${s.names[p]} (toi)` : s.names[p],
          ' ',
          h('b', {}, String(s.scores[p])),
        ),
      ),
    );
    s.board.forEach((v, i) => {
      cells[i].className = 'c4-cell' + (v ? ` p${v}` : '') + (s.line.includes(i) ? ' win' : '') + (s.last === i ? ' last' : '');
    });
    heads.forEach((el, c) => {
      el.className = 'c4-head' + (myTurn() && c === cursor ? ` p${myIndex() + 1}` : '');
    });

    const mine = myIndex();
    if (s.result === 'draw') status.textContent = 'Match nul. R pour la revanche.';
    else if (s.result !== null) status.textContent = (s.result === mine ? 'Gagné !' : `${s.names[s.result]} gagne.`) + ' R pour la revanche.';
    else if (s.turn === mine) status.textContent = 'À toi de jouer.';
    else status.textContent = `${s.names[s.turn]} réfléchit…`;

    if (s.result !== null && multi && s.rematch.length) {
      status.textContent = s.rematch.includes(me.id) ? 'Revanche demandée, en attente de l’adversaire…' : 'L’adversaire veut une revanche : R pour accepter.';
    }
  };

  // --- Autorité (hôte ou solo) ---
  const publish = () => {
    if (multi && isHost && state) room.send('c4:state', state);
    render();
    scheduleAi();
  };

  const hostPlay = (from: string, col: number) => {
    if (!state || state.players[state.turn] !== from) return;
    const next = applyMove(state, col);
    if (!next) return;
    state = next;
    blip(260);
    publish();
  };

  const hostRematch = (from: string) => {
    if (!state || state.result === null || !state.players.includes(from)) return;
    const votes = state.rematch.includes(from) ? state.rematch : [...state.rematch, from];
    const needed = state.players.filter((id) => id !== AI_ID);
    state = needed.every((id) => votes.includes(id)) ? newRound(state) : { ...state, version: state.version + 1, rematch: votes };
    publish();
  };

  let aiTimer: number | undefined;
  const scheduleAi = () => {
    if (multi || !state || state.result !== null || state.players[state.turn] !== AI_ID || aiTimer) return;
    aiTimer = window.setTimeout(() => {
      aiTimer = undefined;
      if (isPanicked() || !state) return; // reprise à la sortie du faux écran
      hostPlay(AI_ID, aiMove(state.board, (state.turn + 1) as 1 | 2));
    }, 450);
  };
  offs.push(onPanicChange((paused) => !paused && scheduleAi()));

  // --- Actions locales ---
  const play = (col: number) => {
    if (!myTurn()) return;
    if (isHost) hostPlay(me.id, col);
    else room!.send('c4:move', { col, version: state!.version });
  };

  const rematch = () => {
    if (!state || state.result === null) return;
    if (isHost) hostRematch(me.id);
    else {
      room!.send('c4:rematch');
      state = { ...state, rematch: [...state.rematch, me.id] };
      render();
    }
  };

  // --- Réseau ---
  if (multi) {
    if (isHost) {
      offs.push(
        room.on('c4:hello', () => state && room.send('c4:state', state)),
        room.on('c4:move', (p: { col: number }, msg) => hostPlay(msg.from, p.col)),
        room.on('c4:rematch', (_p, msg) => hostRematch(msg.from)),
      );
      room.send('c4:state', state);
    } else {
      offs.push(
        room.on('c4:state', (s: State, msg) => {
          if (msg.from !== room.hostId || (state && s.version <= state.version)) return;
          if (state && s.last !== state.last && s.last !== null) blip(260);
          state = s;
          render();
        }),
      );
      room.send('c4:hello');
    }
  }

  // --- Entrées ---
  const moveCursor = (c: number) => {
    cursor = Math.max(0, Math.min(COLS - 1, c));
    render();
  };
  const colOf = (e: Event) => Number((e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col ?? NaN);
  for (const el of [...cells, ...heads]) {
    el.addEventListener('mouseenter', (e) => moveCursor(colOf(e)));
    el.addEventListener('click', (e) => {
      if (state?.result !== null) return rematch();
      moveCursor(colOf(e));
      play(cursor);
    });
  }

  offs.push(
    pushKeys((e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const over = state !== null && state.result !== null;
      if (key === 'arrowleft' || key === 'q' || key === 'a') moveCursor(cursor - 1);
      else if (key === 'arrowright' || key === 'd') moveCursor(cursor + 1);
      else if (key === 'enter' || key === ' ' || key === 'arrowdown' || key === 's') {
        e.preventDefault();
        if (over) {
          if (key === 'enter' || key === ' ') rematch();
        } else play(cursor);
      } else if (key === 'r') rematch();
      else if (key === 'backspace') {
        e.preventDefault();
        ctx.onExit();
        return;
      } else return;
      e.preventDefault();
    }),
  );

  render();
  scheduleAi();

  return () => {
    clearTimeout(aiTimer);
    offs.forEach((off) => off());
  };
}

export const connect4: Game = {
  id: 'connect4',
  name: 'Puissance 4',
  description: 'Solo contre l’ordinateur ou à deux en salon',
  modes: ['solo', 'multi'],
  minPlayers: 2,
  maxPlayers: 2,
  mount,
};
