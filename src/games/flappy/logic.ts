import { xorshift32 } from '../g2048/rng';

// Flappy Bird : physique entière à 60 ticks/s, tuyaux tirés d'une graine.
// Doit rester identique à public.flappy_replay (supabase/migrations/0004_…sql).
// Unités : 1 = 0,1 pixel. Monde de 300 × 500 pixels.

export const W = 3000;
export const H = 5000;
export const BIRD_X = 800;
export const BIRD_R = 140; // demi-côté de la boîte de collision
export const PIPE_W = 520;
export const GAP = 1400; // hauteur de l'ouverture
const GRAVITY = 6;
const FLAP = -95;
const MAX_FALL = 120;
const PIPE_SPEED = 18;
const PIPE_EVERY = 95; // ticks entre deux tuyaux
export const TICK_MS = 1000 / 60;

export interface Pipe {
  x: number;
  gy: number; // centre de l'ouverture
  passed: boolean;
}

export interface State {
  rng: number;
  y: number;
  vy: number;
  pipes: Pipe[];
  tick: number;
  score: number;
  dead: boolean;
}

export const newGame = (seed: number): State => ({ rng: seed, y: 2500, vy: 0, pipes: [], tick: 0, score: 0, dead: false });

/** Un tick. `flap` : le joueur a appuyé depuis le tick précédent. */
export function step(s: State, flap: boolean): void {
  if (s.dead) return;
  if (flap) s.vy = FLAP;
  s.vy = Math.min(s.vy + GRAVITY, MAX_FALL);
  s.y += s.vy;
  if (s.y - BIRD_R < 0) {
    s.y = BIRD_R;
    s.vy = 0;
  }
  if (s.tick % PIPE_EVERY === 0) {
    s.rng = xorshift32(s.rng);
    s.pipes.push({ x: W, gy: 1100 + Math.floor((s.rng * 2801) / 4294967296), passed: false });
  }
  for (const p of s.pipes) p.x -= PIPE_SPEED;
  if (s.pipes.length && s.pipes[0].x + PIPE_W < 0) s.pipes.shift();
  for (const p of s.pipes) {
    if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
      p.passed = true;
      s.score++;
    }
    const overlapX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W;
    const inGap = s.y - BIRD_R > p.gy - GAP / 2 && s.y + BIRD_R < p.gy + GAP / 2;
    if (overlapX && !inGap) s.dead = true;
  }
  if (s.y + BIRD_R >= H) s.dead = true;
  s.tick++;
}

/** Codage des battements envoyé au serveur : écarts entre ticks, séparés par des virgules. */
export function encodeFlaps(ticks: number[]): string {
  return ticks.map((t, i) => t - (i ? ticks[i - 1] : 0)).join(',');
}

export function replay(seed: number, flaps: number[]): State {
  const s = newGame(seed);
  let i = 0;
  while (!s.dead && s.tick < 400000) {
    const f = i < flaps.length && flaps[i] === s.tick;
    if (f) i++;
    step(s, f);
  }
  return s;
}
