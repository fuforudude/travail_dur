import { isTyping, pushKeys } from '../../core/input';
import { isPanicked, onPanicChange } from '../../core/panic';
import { blip } from '../../core/sound';
import { getBest, setBest } from '../../core/storage';
import { flushPending, startRanked, submitMessage, submitRanked } from '../../net/ranked';
import { multiConfigured } from '../../net/supabase';
import { h, hints } from '../../ui/dom';
import { randomSeed } from '../g2048/rng';
import type { Game, GameContext } from '../types';
import { ghostY, gravityMs, H, newGame, shape, step, W, type Action, type State } from './logic';

const KEYS: Record<string, Action> = {
  arrowleft: 'L', q: 'L', a: 'L',
  arrowright: 'R', d: 'R',
  arrowdown: 'D', s: 'D',
  arrowup: 'C', x: 'C', z: 'C', w: 'C',
  c: 'A',
  ' ': 'H',
};

function mount(ctx: GameContext): () => void {
  let s: State | null = null;
  let events = '';
  let session: string | null = null;
  let best = getBest('tetris');
  let paused = false;
  let starting = false;
  let disposed = false;
  let timer: number | undefined;
  let note = '';

  const cells = Array.from({ length: W * H }, () => h('div', { class: 'tt-cell' }));
  const nextCells = Array.from({ length: 16 }, () => h('div', { class: 'tt-cell' }));
  const overlay = h('div', { class: 'overlay', hidden: true });
  const stat = (label: string) => {
    const b = h('b', {}, '0');
    return { el: h('div', { class: 'tt-stat' }, h('span', { class: 'muted small' }, label), b), b };
  };
  const scoreS = stat('Score');
  const linesS = stat('Lignes');
  const levelS = stat('Niveau');
  const bestS = stat('Record');
  const rankEl = h('p', { class: 'muted small' });
  const noteEl = h('p', { class: 'status small' });

  ctx.root.append(
    h(
      'div',
      { class: 'game' },
      h(
        'div',
        { class: 'tt' },
        h('div', { class: 'overlay-wrap' }, h('div', { class: 'tt-board' }, ...cells), overlay),
        h(
          'aside',
          { class: 'tt-side' },
          h('div', { class: 'tt-next-wrap' }, h('span', { class: 'muted small' }, 'Suivante'), h('div', { class: 'tt-next' }, ...nextCells)),
          scoreS.el,
          linesS.el,
          levelS.el,
          bestS.el,
          rankEl,
        ),
      ),
      noteEl,
      hints(['← →', 'déplacer'], ['↑ X', 'tourner'], ['C', 'sens inverse'], ['↓', 'descendre'], ['Espace', 'lâcher'], ['P', 'pause'], ['R', 'rejouer'], ['Retour arrière', 'quitter']),
    ),
  );

  const showOverlay = (title: string, text: string) => {
    overlay.replaceChildren(h('strong', {}, title), h('span', { class: 'muted small' }, text));
    overlay.hidden = false;
  };

  const render = () => {
    noteEl.textContent = note;
    rankEl.textContent = session ? 'partie classée' : multiConfigured ? 'non classée' : '';
    if (!s) {
      if (starting) showOverlay('Préparation…', 'Récupération de la partie auprès du serveur');
      return;
    }
    const view = s.board.slice();
    if (!s.over) {
      const c = shape(s.piece, s.rot);
      const gy = ghostY(s);
      for (let i = 0; i < 4; i++) {
        const gi = (gy + c[i * 2 + 1]) * W + s.x + c[i * 2];
        if (!view[gi]) view[gi] = -s.piece; // fantôme : valeur négative
      }
      for (let i = 0; i < 4; i++) view[(s.y + c[i * 2 + 1]) * W + s.x + c[i * 2]] = s.piece;
    }
    view.forEach((v, i) => {
      cells[i].className = 'tt-cell' + (v > 0 ? ` k${v}` : v < 0 ? ` ghost k${-v}` : '');
    });
    const next = s.queue[0];
    const nc = shape(next, 0);
    nextCells.forEach((el) => (el.className = 'tt-cell'));
    for (let i = 0; i < 4; i++) nextCells[nc[i * 2 + 1] * 4 + nc[i * 2]].className = `tt-cell k${next}`;
    scoreS.b.textContent = String(s.score);
    linesS.b.textContent = String(s.lines);
    levelS.b.textContent = String(s.level);
    bestS.b.textContent = String(Math.max(best, s.score));
    overlay.hidden = true;
    if (s.over) showOverlay('Partie terminée', `Score : ${s.score} · R pour rejouer`);
    else if (paused) showOverlay('Pause', 'P pour reprendre');
  };

  /** Envoie la partie au serveur (si classée et non vide), une seule fois. */
  const finish = () => {
    if (!s) return;
    best = setBest('tetris', s.score);
    if (!session || !events) return;
    const id = session;
    session = null;
    void submitRanked('tetris', id, events).then((r) => {
      if (disposed) return;
      note = submitMessage(r);
      render();
    });
  };

  const act = (a: Action) => {
    if (!s || s.over || paused || starting) return;
    events += a;
    const cleared = step(s, a);
    if (cleared > 0) blip(400 + cleared * 80, 0.08);
    if (s.over) {
      stopGravity();
      finish();
    } else if (a !== 'G' && cleared >= 0) {
      scheduleGravity(); // nouvelle pièce : la gravité repart de zéro
    }
    render();
  };

  const stopGravity = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const scheduleGravity = () => {
    stopGravity();
    if (!s || s.over || paused || isPanicked()) return;
    timer = window.setTimeout(() => {
      act('G');
      scheduleGravity();
    }, gravityMs(s.level));
  };

  const setPaused = (p: boolean) => {
    paused = p;
    if (paused) stopGravity();
    else scheduleGravity();
    render();
  };

  const start = async () => {
    stopGravity();
    s = null;
    events = '';
    session = null;
    paused = false;
    starting = multiConfigured;
    render();
    let seed = randomSeed();
    try {
      const r = await startRanked('tetris');
      if (r) {
        seed = r.seed;
        session = r.id;
      }
    } catch (e) {
      note = `Partie non classée : ${(e as Error).message}.`;
    }
    if (disposed) return;
    starting = false;
    s = newGame(seed);
    render();
    scheduleGravity();
  };

  const offPanic = onPanicChange((p) => (p ? stopGravity() : scheduleGravity()));
  void flushPending('tetris');
  void start();

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (KEYS[key]) {
      e.preventDefault();
      act(KEYS[key]);
    } else if (key === 'p') {
      if (s && !s.over) setPaused(!paused);
    } else if (key === 'r') {
      if (starting) return;
      if (s && !s.over) finish(); // une partie abandonnée compte quand même
      note = '';
      void start();
    } else if (key === 'backspace') {
      e.preventDefault();
      ctx.onExit();
    }
  });

  return () => {
    disposed = true;
    stopGravity();
    if (s && !s.over) finish();
    offPanic();
    popKeys();
  };
}

export const tetris: Game = {
  id: 'tetris',
  name: 'Tetris',
  description: 'Solo · classé',
  modes: ['solo'],
  mount,
};
