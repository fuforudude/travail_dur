import { isTyping, pushKeys } from '../../core/input';
import { isPanicked } from '../../core/panic';
import { blip } from '../../core/sound';
import { getBest, setBest } from '../../core/storage';
import { flushPending, startRanked, submitMessage, submitRanked } from '../../net/ranked';
import { multiConfigured } from '../../net/supabase';
import { isTouch } from '../../core/touch';
import { h, hints } from '../../ui/dom';
import { randomSeed } from '../g2048/rng';
import type { Game, GameContext } from '../types';
import { BIRD_R, BIRD_X, encodeFlaps, GAP, H, newGame, PIPE_W, step, TICK_MS, W, type State } from './logic';

function mount(ctx: GameContext): () => void {
  let s: State | null = null;
  let seed = 0;
  let session: string | null = null;
  let started = false; // le premier battement lance la partie
  let flaps: number[] = [];
  let flapQueued = false;
  let best = getBest('flappy');
  let note = '';
  let preparing = false;
  let acc = 0;
  let last = 0;
  let raf = 0;
  let disposed = false;
  let prevY = 2500;
  let diedAt = 0; // un appui juste après la chute ne relance pas la partie par erreur

  const canvas = h('canvas', { class: 'fb-canvas' });
  const g = canvas.getContext('2d')!;
  const scoreEl = h('b', {}, '0');
  const bestEl = h('b', {}, String(best));
  const rankEl = h('span', { class: 'muted small' });
  const noteEl = h('p', { class: 'status small' });
  ctx.root.append(
    h(
      'div',
      { class: 'game' },
      h('div', { class: 'game-bar fb-bar' }, h('span', { class: 'stat' }, 'Score ', scoreEl), rankEl, h('span', { class: 'stat' }, 'Record ', bestEl)),
      canvas,
      noteEl,
      hints(['Espace ↑', 'battre des ailes'], ['R', 'rejouer'], ['Retour arrière', 'quitter']),
    ),
  );

  let scale = 1;
  const resize = () => {
    const avail = Math.min(ctx.root.clientWidth - 32, 340, (window.innerHeight - 260) * (W / H));
    scale = Math.max(160, avail) / W;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = W * scale * ratio;
    canvas.height = H * scale * ratio;
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    g.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
  };

  const colors = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return { sky: v('--surface'), ground: v('--surface-2'), pipe: v('--tone3'), bird: v('--p2'), eye: v('--text'), text: v('--text'), muted: v('--muted') };
  };

  const draw = (frac: number) => {
    const c = colors();
    g.fillStyle = c.sky;
    g.fillRect(0, 0, W, H);
    if (s) {
      for (const p of s.pipes) {
        const x = p.x - 18 * (1 - frac) * (started && !s.dead ? 1 : 0);
        g.fillStyle = c.pipe;
        g.fillRect(x, 0, PIPE_W, p.gy - GAP / 2);
        g.fillRect(x, p.gy + GAP / 2, PIPE_W, H - (p.gy + GAP / 2));
        g.fillRect(x - 30, p.gy - GAP / 2 - 160, PIPE_W + 60, 160);
        g.fillRect(x - 30, p.gy + GAP / 2, PIPE_W + 60, 160);
      }
      const y = prevY + (s.y - prevY) * frac;
      g.save();
      g.translate(BIRD_X, y);
      g.rotate(Math.max(-0.5, Math.min(1.2, s.vy / 110)));
      g.fillStyle = c.bird;
      g.beginPath();
      g.ellipse(0, 0, BIRD_R + 30, BIRD_R, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = c.eye;
      g.beginPath();
      g.arc(70, -40, 26, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = c.text;
    g.textAlign = 'center';
    g.font = `600 ${Math.round(220)}px system-ui, sans-serif`;
    if (s && started) g.fillText(String(s.score), W / 2, 500);
    g.font = `500 ${Math.round(150)}px system-ui, sans-serif`;
    if (preparing) g.fillText('Préparation…', W / 2, H / 2);
    else if (s && !started) g.fillText(isTouch() ? 'Touche pour commencer' : 'Espace pour commencer', W / 2, H / 2 + 700);
    else if (s?.dead) {
      g.fillText('Perdu !', W / 2, H / 2 - 100);
      g.fillStyle = c.muted;
      g.fillText(isTouch() ? 'Touche pour rejouer' : 'R pour rejouer', W / 2, H / 2 + 120);
    }
  };

  const render = () => {
    scoreEl.textContent = String(s?.score ?? 0);
    bestEl.textContent = String(best);
    rankEl.textContent = session ? 'partie classée' : multiConfigured ? 'non classée' : '';
    noteEl.textContent = note;
    draw(1);
  };

  const finish = () => {
    if (!s) return;
    best = setBest('flappy', s.score);
    if (session && flaps.length) {
      const id = session;
      session = null;
      void submitRanked('flappy', id, encodeFlaps(flaps)).then((r) => {
        if (disposed) return;
        note = submitMessage(r);
        render();
      });
    }
    render();
  };

  const start = async () => {
    started = false;
    flaps = [];
    s = null;
    session = null;
    preparing = multiConfigured;
    render();
    seed = randomSeed();
    try {
      const r = await startRanked('flappy');
      if (r) {
        seed = r.seed;
        session = r.id;
      }
    } catch (e) {
      note = `Partie non classée : ${(e as Error).message}.`;
    }
    if (disposed) return;
    preparing = false;
    s = newGame(seed);
    prevY = s.y;
    render();
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(now - last, 250);
    last = now;
    if (!s || !started || s.dead || isPanicked()) return;
    acc += dt;
    while (acc >= TICK_MS && !s.dead) {
      acc -= TICK_MS;
      prevY = s.y;
      const flap = flapQueued;
      flapQueued = false;
      if (flap) flaps.push(s.tick);
      const before = s.score;
      step(s, flap);
      if (s.score > before) {
        blip(660, 0.04);
        scoreEl.textContent = String(s.score);
      }
      if (s.dead) {
        blip(160, 0.15);
        diedAt = performance.now();
        finish();
        return;
      }
    }
    draw(acc / TICK_MS);
  };

  const flap = () => {
    if (!s || s.dead || preparing) return;
    if (!started) {
      started = true;
      acc = TICK_MS; // le premier tick part tout de suite, avec ce battement
      last = performance.now();
    }
    flapQueued = true;
    blip(520, 0.02);
  };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (s?.dead && e.pointerType !== 'mouse') {
      if (performance.now() - diedAt < 600) return;
      note = '';
      return void start();
    }
    flap();
  });

  const popKeys = pushKeys((e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'arrowup' || key === 'z' || key === 'w') {
      e.preventDefault();
      if (!e.repeat) flap();
    } else if (key === 'r') {
      if (s && started && !s.dead) finish();
      note = '';
      void start();
    } else if (key === 'backspace') {
      e.preventDefault();
      ctx.onExit();
    }
  });

  const onResize = () => {
    resize();
    draw(1);
  };
  window.addEventListener('resize', onResize);
  resize();
  void flushPending('flappy');
  void start();
  last = performance.now();
  raf = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    popKeys();
  };
}

export const flappy: Game = {
  id: 'flappy',
  name: 'Flappy Bird',
  description: 'Solo · classé',
  modes: ['solo'],
  mount,
};
