import { isTyping, pushKeys } from '../../core/input';
import { blip } from '../../core/sound';
import { getBest, load, remove, save, setBest } from '../../core/storage';
import { h, hints } from '../../ui/dom';
import type { Game, GameContext } from '../types';
import { addRandom, canMove, move, newGame, type Dir, type Grid } from './logic';

interface State {
  grid: Grid;
  score: number;
  won: boolean; // 2048 atteint
  keepPlaying: boolean; // a choisi de continuer après la victoire
}

const KEYS: Record<string, Dir> = {
  arrowup: 'up', w: 'up', z: 'up',
  arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left', q: 'left',
  arrowright: 'right', d: 'right',
};

function fresh(): State {
  return { grid: newGame(), score: 0, won: false, keepPlaying: false };
}

function mount(ctx: GameContext): () => void {
  let state: State = load<State | null>('state:2048', null) ?? fresh();
  let best = Math.max(getBest('2048'), state.score);

  const scoreEl = h('b', {}, '0');
  const bestEl = h('b', {}, '0');
  const cells = state.grid.map(() => h('div', { class: 'cell' }));
  const board = h('div', { class: 'board-2048' }, ...cells);
  const overlay = h('div', { class: 'overlay', hidden: true });
  ctx.root.append(
    h(
      'div',
      { class: 'game' },
      h('div', { class: 'game-bar' }, h('span', { class: 'stat' }, 'Score ', scoreEl), h('span', { class: 'stat' }, 'Record ', bestEl)),
      h('div', { class: 'overlay-wrap' }, board, overlay),
      hints(['← ↑ → ↓', 'jouer'], ['R', 'recommencer'], ['Retour arrière', 'quitter']),
    ),
  );

  const showOverlay = (title: string, text: string) => {
    overlay.replaceChildren(h('strong', {}, title), h('span', { class: 'muted small' }, text));
    overlay.hidden = false;
  };

  const render = (merged: number[] = []) => {
    state.grid.forEach((v, i) => {
      const c = cells[i];
      c.textContent = v ? String(v) : '';
      c.style.setProperty('--l', String(v ? Math.log2(v) : 0));
      c.className =
        'cell' + (v ? ' tile' : '') + (v >= 128 ? ' big' : '') + (v >= 1024 ? ' huge' : '') + (merged.includes(i) ? ' merged' : '');
    });
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(best);
    overlay.hidden = true;
    if (state.won && !state.keepPlaying) showOverlay('2048 !', 'Entrée pour continuer · R pour recommencer');
    else if (!canMove(state.grid)) showOverlay('Plus de coups possibles', `Score : ${state.score} · R pour recommencer`);
  };

  const persist = () => {
    best = setBest('2048', state.score);
    if (canMove(state.grid)) save('state:2048', state);
    else remove('state:2048');
  };

  const play = (dir: Dir) => {
    if (state.won && !state.keepPlaying) return;
    const r = move(state.grid, dir);
    if (!r.moved) return;
    state = { ...state, grid: addRandom(r.grid), score: state.score + r.gained };
    if (!state.won && state.grid.includes(2048)) state.won = true;
    if (r.gained) blip(330 + Math.log2(r.gained) * 30);
    persist();
    render(r.merged);
  };

  const restart = () => {
    state = fresh();
    persist();
    render();
  };

  // Balayage tactile, pour le mobile.
  let start: { x: number; y: number } | null = null;
  board.addEventListener('pointerdown', (e) => (start = { x: e.clientX, y: e.clientY }));
  board.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });

  render();

  return pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (KEYS[key]) {
      e.preventDefault();
      play(KEYS[key]);
    } else if (key === 'r') {
      restart();
    } else if (key === 'enter' && state.won && !state.keepPlaying) {
      state.keepPlaying = true;
      persist();
      render();
    } else if (key === 'backspace') {
      e.preventDefault();
      ctx.onExit();
    }
  });
}

export const game2048: Game = {
  id: '2048',
  name: '2048',
  description: 'Solo · fusionner les tuiles',
  modes: ['solo'],
  mount,
};
