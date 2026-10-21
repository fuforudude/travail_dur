import { isTyping, pushKeys } from '../../core/input';
import { blip } from '../../core/sound';
import { getBest, load, remove, save, setBest } from '../../core/storage';
import { flushPending, startRanked, submitMessage, submitRanked } from '../../net/ranked';
import { multiConfigured } from '../../net/supabase';
import { isTouch, pressKey, touchPad } from '../../core/touch';
import { h, hints } from '../../ui/dom';
import type { Game, GameContext } from '../types';
import { addRandom, canMove, DIR_CODE, move, replay, type Dir, type Grid } from './logic';
import { randomSeed } from './rng';

/** Ce qui est sauvegardé : la graine et les coups suffisent à reconstruire la partie. */
interface Saved {
  seed: number;
  moves: string;
  session: string | null; // partie enregistrée côté serveur (classée), sinon null
  keepPlaying: boolean;
}

const KEYS: Record<string, Dir> = {
  arrowup: 'up', w: 'up', z: 'up',
  arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left', q: 'left',
  arrowright: 'right', d: 'right',
};

function mount(ctx: GameContext): () => void {
  let saved: Saved | null = load<Saved | null>('state:2048', null);
  let grid: Grid = [];
  let seed = 0;
  let score = 0;
  let best = getBest('2048');
  let starting = false;
  let disposed = false;
  let note = '';

  const scoreEl = h('b', {}, '0');
  const bestEl = h('b', {}, '0');
  const rankEl = h('span', { class: 'muted small' });
  const cells = Array.from({ length: 16 }, () => h('div', { class: 'cell' }));
  const board = h('div', { class: 'board-2048' }, ...cells);
  const overlay = h('div', { class: 'overlay', hidden: true });
  const noteEl = h('p', { class: 'status small' });
  ctx.root.append(
    h(
      'div',
      { class: 'game' },
      h('div', { class: 'game-bar' }, h('span', { class: 'stat' }, 'Score ', scoreEl), rankEl, h('span', { class: 'stat' }, 'Record ', bestEl)),
      h('div', { class: 'overlay-wrap' }, board, overlay),
      noteEl,
      touchPad([{ label: 'Recommencer', key: 'r' }]),
      hints(['← ↑ → ↓', 'jouer'], ['R', 'recommencer'], ['Retour arrière', 'quitter']),
    ),
  );

  const won = () => grid.includes(2048) && !saved?.keepPlaying;
  const over = () => grid.length > 0 && !canMove(grid);

  const showOverlay = (title: string, text: string) => {
    overlay.replaceChildren(h('strong', {}, title), h('span', { class: 'muted small' }, text));
    overlay.hidden = false;
  };

  const render = (merged: number[] = []) => {
    grid.forEach((v, i) => {
      const c = cells[i];
      c.textContent = v ? String(v) : '';
      c.style.setProperty('--l', String(v ? Math.log2(v) : 0));
      if (v) c.dataset.v = String(Math.min(v, 4096));
      else delete c.dataset.v;
      c.className =
        'cell' + (v >= 128 ? ' big' : '') + (v >= 1024 ? ' huge' : '') + (merged.includes(i) ? ' merged' : '');
    });
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    rankEl.textContent = saved?.session ? 'partie classée' : multiConfigured ? 'non classée' : '';
    noteEl.textContent = note;
    overlay.hidden = true;
    if (starting) showOverlay('Préparation…', 'La partie va commencer.');
    else if (won()) showOverlay('2048 !', isTouch() ? 'Touche le plateau pour continuer' : 'Entrée pour continuer · R pour recommencer');
    else if (over()) showOverlay('Plus de coups possibles', `Score : ${score}${isTouch() ? '' : ' · R pour recommencer'}`);
  };

  const persist = () => {
    best = setBest('2048', score);
    if (saved && !over()) save('state:2048', saved);
    else remove('state:2048');
  };

  /** Enregistre la partie en cours auprès du serveur (si elle est classée et non vide). */
  const finish = () => {
    if (!saved?.session || !saved.moves) return;
    void submitRanked('g2048', saved.session, saved.moves).then((r) => {
      if (disposed) return;
      note = submitMessage(r);
      render();
    });
  };

  const restore = (s: Saved) => {
    const r = replay(s.seed, s.moves);
    saved = s;
    grid = r.grid;
    seed = r.seed;
    score = r.score;
  };

  const start = async () => {
    starting = multiConfigured;
    if (starting) render();
    let s: Saved = { seed: randomSeed(), moves: '', session: null, keepPlaying: false };
    try {
      const r = await startRanked('g2048');
      if (r) s = { ...s, seed: r.seed, session: r.id };
    } catch (e) {
      note = `Partie non classée : ${(e as Error).message}.`;
    }
    if (disposed) return;
    starting = false;
    restore(s);
    persist();
    render();
  };

  const play = (dir: Dir) => {
    if (starting || !saved || won()) return;
    const r = move(grid, dir);
    if (!r.moved) return;
    ({ grid, seed } = addRandom(r.grid, seed));
    score += r.gained;
    saved = { ...saved, moves: saved.moves + DIR_CODE[dir] };
    if (r.gained) blip(330 + Math.log2(r.gained) * 30);
    if (!canMove(grid)) finish();
    persist();
    render(r.merged);
  };

  const restart = () => {
    if (starting) return;
    if (!over()) finish(); // une partie abandonnée compte quand même
    note = '';
    void start();
  };

  // Balayage tactile, pour le mobile.
  let touch: { x: number; y: number } | null = null;
  board.addEventListener('pointerdown', (e) => (touch = { x: e.clientX, y: e.clientY }));
  board.addEventListener('pointerup', (e) => {
    if (!touch) return;
    const dx = e.clientX - touch.x;
    const dy = e.clientY - touch.y;
    touch = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return void (e.pointerType !== 'mouse' && pressKey('Enter')); // appui : « continuer » après 2048
    play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  });

  try {
    if (saved && typeof saved.seed === 'number' && /^[UDLR]*$/.test(saved.moves)) restore(saved);
    else saved = null;
  } catch {
    saved = null; // sauvegarde corrompue
  }
  if (saved) render();
  else void start();
  void flushPending('g2048');

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (KEYS[key]) {
      e.preventDefault();
      play(KEYS[key]);
    } else if (key === 'r') {
      restart();
    } else if (key === 'enter' && won() && saved) {
      saved = { ...saved, keepPlaying: true };
      persist();
      render();
    } else if (key === 'backspace') {
      e.preventDefault();
      ctx.onExit();
    }
  });

  return () => {
    disposed = true;
    popKeys();
  };
}

export const game2048: Game = {
  id: '2048',
  name: '2048',
  description: 'Solo · fusionner les tuiles',
  modes: ['solo'],
  mount,
};
