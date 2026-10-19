// Tower defense : simulation 100 % entière et déterministe.
// Doit rester identique à public.td_wave (supabase/migrations/0004_…sql),
// qui rejoue chaque vague côté serveur. Unités : 1 case = 100, 1 tick = 100 ms.

export const COLS = 16;
export const ROWS = 10;
export const START_GOLD = 150;
export const START_LIVES = 20;
export const MAX_LEVEL = 5;

/** Chemin des ennemis, case par case. */
export const PATH: [number, number][] = (() => {
  const p: [number, number][] = [];
  for (let x = 0; x <= 12; x++) p.push([x, 1]);
  for (let y = 2; y <= 4; y++) p.push([12, y]);
  for (let x = 11; x >= 3; x--) p.push([x, 4]);
  for (let y = 5; y <= 7; y++) p.push([3, y]);
  for (let x = 4; x <= 15; x++) p.push([x, 7]);
  return p;
})();
/** Longueur du chemin : un ennemi qui atteint cette progression est passé. */
export const LENGTH = (PATH.length - 1) * 100;
const BUCKET = 10; // finesse du calcul de portée le long du chemin
const BUCKETS = LENGTH / BUCKET + 1;

const onPath = new Set(PATH.map(([x, y]) => y * COLS + x));
export const isBuildable = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !onPath.has(y * COLS + x);

export interface TowerKind {
  name: string;
  cost: number;
  range: number;
  damage: number;
  cooldown: number;
  splash: number; // dégâts de zone le long du chemin (0 = aucun)
}

/** Types de tours 1..3. */
export const KINDS: TowerKind[] = [
  { name: 'Flèche', cost: 50, range: 220, damage: 10, cooldown: 6, splash: 0 },
  { name: 'Canon', cost: 90, range: 190, damage: 18, cooldown: 18, splash: 70 },
  { name: 'Sniper', cost: 120, range: 450, damage: 55, cooldown: 32, splash: 0 },
];

export const towerDamage = (kind: number, level: number) => Math.floor((KINDS[kind - 1].damage * (100 + 60 * (level - 1))) / 100);
export const towerRange = (kind: number, level: number) => KINDS[kind - 1].range + 15 * (level - 1);
export const upgradeCost = (kind: number, level: number) => KINDS[kind - 1].cost * level;

export interface Tower {
  x: number;
  y: number;
  kind: number;
  level: number;
  invested: number;
}

export interface Wave {
  count: number;
  hp: number;
  speed: number;
  gap: number;
  reward: number;
  leak: number;
  type: 'normal' | 'rapide' | 'boss';
}

export function waveInfo(n: number): Wave {
  let hp = 30;
  for (let k = 2; k <= n; k++) hp = Math.floor((hp * 112) / 100) + 3;
  if (n % 10 === 0) {
    const bossHp = hp * 15;
    return { count: n / 10, hp: bossHp, speed: 7, gap: 30, reward: (1 + Math.floor(hp / 12)) * 10, leak: 5, type: 'boss' };
  }
  const count = Math.min(8 + n, 30);
  if (n % 3 === 0) {
    const fastHp = Math.floor((hp * 6) / 10);
    return { count, hp: fastHp, speed: 16, gap: 7, reward: 1 + Math.floor(fastHp / 12), leak: 1, type: 'rapide' };
  }
  return { count, hp, speed: 10, gap: 10, reward: 1 + Math.floor(hp / 12), leak: 1, type: 'normal' };
}

export const waveBonus = (n: number) => 20 + 2 * n;

/** Position (en centièmes de case) d'un point du chemin. */
export function pathPos(progress: number): [number, number] {
  const i = Math.floor(progress / 100);
  const f = progress % 100;
  const [x0, y0] = PATH[i];
  const [x1, y1] = PATH[Math.min(i + 1, PATH.length - 1)];
  return [x0 * 100 + 50 + (x1 - x0) * f, y0 * 100 + 50 + (y1 - y0) * f];
}

/** Pour chaque tranche du chemin : est-elle à portée de la tour ? */
function coverage(t: Tower): Uint8Array {
  const cov = new Uint8Array(BUCKETS);
  const r = towerRange(t.kind, t.level);
  const cx = t.x * 100 + 50;
  const cy = t.y * 100 + 50;
  for (let b = 0; b < BUCKETS; b++) {
    const [x, y] = pathPos(b * BUCKET);
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) cov[b] = 1;
  }
  return cov;
}

export interface State {
  wave: number; // vagues terminées
  lives: number;
  gold: number;
  kills: number;
  towers: Tower[];
  over: boolean;
}

export const newGame = (): State => ({ wave: 0, lives: START_LIVES, gold: START_GOLD, kills: 0, towers: [], over: false });

// --- Actions de construction ---------------------------------------------------------
// Codage envoyé au serveur, séparé par « ; » : B<x>.<y>.<type>  U<x>.<y>  S<x>.<y>
// Pendant une vague, l'action est suivie de @<tick> : elle s'applique juste avant ce tick.

const towerAt = (s: State, x: number, y: number) => s.towers.findIndex((t) => t.x === x && t.y === y);

/** Applique une action ; retourne un message d'erreur (et ne change rien) si elle est impossible. */
export function applyAction(s: State, a: string): string | null {
  const m = /^([BUS])(\d+)\.(\d+)(?:\.(\d))?$/.exec(a);
  if (!m) return 'action invalide';
  const x = Number(m[2]);
  const y = Number(m[3]);
  const i = towerAt(s, x, y);
  if (m[1] === 'B') {
    const kind = Number(m[4]);
    if (!(kind >= 1 && kind <= KINDS.length)) return 'tour inconnue';
    if (!isBuildable(x, y)) return 'emplacement impossible';
    if (i >= 0) return 'case occupée';
    if (s.gold < KINDS[kind - 1].cost) return 'pas assez d’or';
    s.gold -= KINDS[kind - 1].cost;
    s.towers.push({ x, y, kind, level: 1, invested: KINDS[kind - 1].cost });
  } else if (m[1] === 'U') {
    if (i < 0) return 'pas de tour ici';
    const t = s.towers[i];
    if (t.level >= MAX_LEVEL) return 'niveau maximum';
    const c = upgradeCost(t.kind, t.level);
    if (s.gold < c) return 'pas assez d’or';
    s.gold -= c;
    t.level++;
    t.invested += c;
  } else {
    if (i < 0) return 'pas de tour ici';
    s.gold += Math.floor(s.towers[i].invested / 2);
    s.towers.splice(i, 1);
  }
  return null;
}

// --- Simulation d'une vague ---------------------------------------------------------

export interface Enemy {
  progress: number;
  hp: number;
  maxHp: number;
  state: 0 | 1 | 2; // 0 pas encore apparu, 1 en vie, 2 mort ou passé
}

export interface Shot {
  tower: number; // index de la tour
  target: number; // index de l'ennemi
}

/**
 * Simulation tick par tick d'une vague. `tick()` avance d'un pas et retourne false quand
 * la vague est finie. Les compteurs (or, vies, victimes) sont appliqués à `s` au fil de l'eau.
 */
export function startWave(s: State) {
  const n = s.wave + 1;
  const w = waveInfo(n);
  const enemies: Enemy[] = Array.from({ length: w.count }, () => ({ progress: 0, hp: w.hp, maxHp: w.hp, state: 0 }));
  type Live = { t: Tower; cov: Uint8Array; damage: number; kind: TowerKind; cd: number };
  let towers: Live[] = [];
  /** Recalcule les tours après une construction ; une tour existante garde sa recharge en cours. */
  const derive = () => {
    const cds = new Map(towers.map((tw) => [`${tw.t.x}.${tw.t.y}`, tw.cd]));
    towers = s.towers.map((t) => ({
      t,
      cov: coverage(t),
      damage: towerDamage(t.kind, t.level),
      kind: KINDS[t.kind - 1],
      cd: cds.get(`${t.x}.${t.y}`) ?? 0,
    }));
  };
  derive();
  let spawned = 0;
  let first = 0; // tous les ennemis avant celui-ci sont morts ou passés
  let ticks = 0;
  let done = false;

  const hit = (e: Enemy, dmg: number) => {
    e.hp -= dmg;
    if (e.hp <= 0 && e.state === 1) {
      e.state = 2;
      s.gold += w.reward;
      s.kills++;
    }
  };

  function tick(shots?: Shot[]): boolean {
    if (done) return false;
    // 1. apparition
    if (spawned < w.count && ticks % w.gap === 0) enemies[spawned++].state = 1;
    // 2. déplacement
    for (let i = first; i < spawned; i++) {
      const e = enemies[i];
      if (e.state !== 1) continue;
      e.progress += w.speed;
      if (e.progress >= LENGTH) {
        e.state = 2;
        s.lives -= w.leak;
      }
    }
    // 3. tirs : chaque tour vise l'ennemi le plus avancé à sa portée (même vitesse pour toute
    //    la vague, donc l'ordre d'apparition est l'ordre sur le chemin)
    for (let ti = 0; ti < towers.length; ti++) {
      const tw = towers[ti];
      if (tw.cd > 0) {
        tw.cd--;
        continue;
      }
      for (let i = first; i < spawned; i++) {
        const e = enemies[i];
        if (e.state !== 1 || !tw.cov[Math.floor(e.progress / BUCKET)]) continue;
        const at = e.progress;
        if (tw.kind.splash) {
          for (let j = first; j < spawned; j++) {
            const o = enemies[j];
            if (o.state === 1 && Math.abs(o.progress - at) <= tw.kind.splash) hit(o, tw.damage);
          }
        } else hit(e, tw.damage);
        tw.cd = tw.kind.cooldown;
        shots?.push({ tower: ti, target: i });
        break;
      }
    }
    while (first < spawned && enemies[first].state === 2) first++;
    ticks++;
    if (s.lives <= 0) {
      s.lives = 0;
      s.over = true;
      done = true;
    } else if (spawned === w.count && first === w.count) {
      s.wave = n;
      s.gold += waveBonus(n);
      done = true;
    }
    return !done;
  }

  /** Construction pendant la vague : appliquée avant le prochain tick. Retourne l'erreur éventuelle. */
  function act(a: string): string | null {
    if (done) return 'vague terminée';
    const err = applyAction(s, a);
    if (!err) derive();
    return err;
  }

  return { wave: w, number: n, enemies, tick, act, ticks: () => ticks, done: () => done };
}

/** Joue une vague d'un coup (tests, vérification). Retourne le nombre de ticks. */
export function runWave(s: State): number {
  const w = startWave(s);
  while (w.tick());
  return w.ticks();
}
