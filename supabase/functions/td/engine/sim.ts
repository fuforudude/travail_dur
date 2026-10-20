// Copie de src/games/towerdefense/engine/sim.ts (scripts/td-sync.mjs) : ne pas modifier ici.
// Tower defense roguelike : simulation déterministe d'une partie, vague par vague.
// Le même fichier tourne dans le navigateur et dans la fonction serveur (supabase/functions/td),
// qui rejoue chaque vague avec les actions du joueur : seules + − × ÷ et Math.sqrt/floor/min/max
// sont utilisés, pour un résultat identique au bit près des deux côtés.

import {
  COLS, deckSlots, ENEMIES, FINAL_WAVE, FREE_ITEMS, hpMult, LENGTH, MINI, PATH, ROWS, SELL_RATIO, START_GOLD, START_LIVES,
  themeOf, tierOfWave, TOWERS, towerStats, waveBonus, waveBudget, type DamageType, type TowerStats,
} from './data.ts';

export const TICK = 0.1; // s
const MAX_TICKS = 30000; // garde-fou : une vague ne dure jamais 50 minutes

// --- Hasard reproductible -----------------------------------------------------------------------

export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const subSeed = (seed: number, wave: number, k: number) => (Math.imul(seed ^ Math.imul(wave + 1, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(k, 0xc2b2ae35)) >>> 0;

// --- Carte --------------------------------------------------------------------------------------

const onPath = new Set(PATH.map(([x, y]) => y * COLS + x));
export const isBuildable = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !onPath.has(y * COLS + x);

/** Position (centre de case = .5) d'un point du chemin. */
export function pathPos(p: number): [number, number] {
  const c = Math.max(0, Math.min(p, LENGTH));
  const i = Math.min(Math.floor(c), LENGTH - 1);
  const f = c - i;
  const [x0, y0] = PATH[i];
  const [x1, y1] = PATH[i + 1];
  return [x0 + 0.5 + (x1 - x0) * f, y0 + 0.5 + (y1 - y0) * f];
}

// --- État d'une partie --------------------------------------------------------------------------

export interface TowerState {
  id: number;
  x: number;
  y: number;
  kind: number; // index dans TOWERS
  level: number; // 0 base, 1 U1, 2 U2
  invested: number;
  fresh: boolean; // posée pendant la préparation en cours : revendue au prix plein
}

export interface RunState {
  seed: number;
  deck: string[];
  unlocked: string[]; // améliorations utilisables
  wave: number; // vagues terminées
  lives: number;
  gold: number;
  kills: number;
  bossKills: number;
  over: boolean;
  lostTo: string | null; // ennemi qui a pris la dernière vie
  towers: TowerState[];
  nextId: number;
}

/** Vérifie un deck ; retourne un message d'erreur ou null. */
export function deckError(deck: string[], owned: string[], bestWave: number): string | null {
  if (!Array.isArray(deck) || deck.length < 1) return 'deck vide';
  if (deck.length > deckSlots(bestWave)) return 'trop de tours dans le deck';
  if (new Set(deck).size !== deck.length) return 'tour en double';
  for (const id of deck) {
    if (!TOWERS.some((t) => t.id === id)) return 'tour inconnue';
    if (!FREE_ITEMS.includes(id) && !owned.includes(id)) return 'tour non débloquée';
  }
  return null;
}

export function newRun(seed: number, deck: string[], owned: string[]): RunState {
  const unlocked = TOWERS.flatMap((t) => t.upgrades.map((u) => u.id)).filter((id) => FREE_ITEMS.includes(id) || owned.includes(id));
  return {
    seed: seed >>> 0, deck: deck.slice(), unlocked, wave: 0, lives: START_LIVES, gold: START_GOLD, kills: 0, bossKills: 0,
    over: false, lostTo: null, towers: [], nextId: 1,
  };
}

export const sellValue = (t: TowerState) => (t.fresh ? t.invested : Math.floor(t.invested * SELL_RATIO));
export const upgradeOf = (t: TowerState) => (t.level < 2 ? TOWERS[t.kind].upgrades[t.level] : null);

// --- Actions ------------------------------------------------------------------------------------
// Codage envoyé au serveur, séparé par « ; » : B<x>.<y>.<tour 0-9>  U<x>.<y>  S<x>.<y>
// Pendant une vague, l'action est suivie de @<tick> : elle s'applique juste avant ce tick.

export const ACTION_RE = /^([BUS])(\d{1,2})\.(\d{1,2})(?:\.(\d))?$/;

/** Applique une action ; retourne un message d'erreur (et ne change rien) si elle est impossible. */
export function applyAction(s: RunState, a: string, running = false): string | null {
  if (s.over) return 'partie terminée';
  const m = ACTION_RE.exec(a);
  if (!m) return 'action invalide';
  const x = Number(m[2]);
  const y = Number(m[3]);
  const i = s.towers.findIndex((t) => t.x === x && t.y === y);
  if (m[1] === 'B') {
    if (m[4] === undefined) return 'action invalide';
    const kind = Number(m[4]);
    const def = TOWERS[kind];
    if (!def || !s.deck.includes(def.id)) return 'tour absente du deck';
    if (!isBuildable(x, y)) return 'emplacement impossible';
    if (i >= 0) return 'case occupée';
    if (def.maxPerMap && s.towers.filter((t) => t.kind === kind).length >= def.maxPerMap) return `${def.maxPerMap} ${def.name} au maximum`;
    if (s.gold < def.cost) return 'pas assez d’or';
    s.gold -= def.cost;
    s.towers.push({ id: s.nextId++, x, y, kind, level: 0, invested: def.cost, fresh: !running });
  } else if (m[4] !== undefined) return 'action invalide';
  else if (m[1] === 'U') {
    if (i < 0) return 'pas de tour ici';
    const t = s.towers[i];
    const up = upgradeOf(t);
    if (!up) return 'niveau maximum';
    if (!s.unlocked.includes(up.id)) return `${up.name} pas encore débloquée`;
    if (s.gold < up.cost) return 'pas assez d’or';
    s.gold -= up.cost;
    t.level++;
    t.invested += up.cost;
  } else {
    if (i < 0) return 'pas de tour ici';
    s.gold += sellValue(s.towers[i]);
    s.towers.splice(i, 1);
  }
  return null;
}

// --- Composition des vagues ---------------------------------------------------------------------

export interface Spawn {
  enemy: number; // index dans ENEMIES
  at: number; // tick
}
export interface WavePlan {
  wave: number;
  spawns: Spawn[];
  intro: number | null; // ennemi présenté pour la première fois
  theme: string | null;
  boss: number | null;
  mult: number;
}

const idx = (id: string) => ENEMIES.findIndex((e) => e.id === id);
const TITAN = idx('titan');
const DEVOURER = idx('devourer');
const BRUTE = idx('brute');
const SPECTER = idx('specter');
const SPLITTER = idx('splitter');
const BANK = TOWERS.find((t) => t.id === 'bank')!;
const threatOf = (e: number) => (ENEMIES[e].abilities.includes('swarm') ? ENEMIES[e].threat * 15 : ENEMIES[e].threat);

export function planWave(seed: number, w: number): WavePlan {
  const rng = makeRng(subSeed(seed, w, 1));
  let budget = waveBudget(w);
  const regular = ENEMIES.map((_, i) => i).filter((i) => ENEMIES[i].tier !== 'boss' && ENEMIES[i].firstWave <= w);
  let boss: number | null = null;
  if (w % 10 === 0) {
    boss = w >= FINAL_WAVE ? DEVOURER : TITAN;
    budget *= 0.5; // escorte
  }
  const theme = boss === null ? themeOf(w) : null;
  const introIdx = regular.find((i) => ENEMIES[i].firstWave === w);
  const intro = introIdx === undefined ? null : introIdx;
  const picks: number[] = [];
  let rest = budget;
  if (intro !== null) {
    const n = Math.max(1, Math.floor((budget * 0.4) / threatOf(intro)));
    for (let k = 0; k < n; k++) picks.push(intro);
    rest -= n * threatOf(intro);
  }
  let pool = regular;
  if (theme) {
    const themed = regular.filter((i) => theme.enemies.includes(ENEMIES[i].id));
    if (themed.length) pool = themed;
  }
  const tier = tierOfWave(w);
  for (;;) {
    const fit = pool.filter((i) => threatOf(i) <= rest);
    if (!fit.length) break;
    const weights = fit.map((i) => (ENEMIES[i].tier === tier ? 1.5 : 1));
    let r = rng() * weights.reduce((a, b) => a + b, 0);
    let pick = fit[fit.length - 1];
    for (let k = 0; k < fit.length; k++) {
      r -= weights[k];
      if (r < 0) {
        pick = fit[k];
        break;
      }
    }
    picks.push(pick);
    rest -= threatOf(pick);
  }
  // Paquets de 5 ennemis du même type (un groupe de larves forme un paquet), dans un ordre tiré au sort.
  const packets: number[][] = [];
  const byType = new Map<number, number>();
  for (const e of picks) {
    if (ENEMIES[e].abilities.includes('swarm')) {
      packets.push(Array(15).fill(e));
      continue;
    }
    const open = byType.get(e);
    if (open !== undefined && packets[open].length < 5) packets[open].push(e);
    else {
      byType.set(e, packets.length);
      packets.push([e]);
    }
  }
  for (let k = packets.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [packets[k], packets[j]] = [packets[j], packets[k]];
  }
  if (boss !== null) packets.splice(Math.floor(packets.length / 2), 0, [boss]);
  const spawns: Spawn[] = [];
  let at = 0;
  for (const p of packets) {
    for (const e of p) {
      spawns.push({ enemy: e, at });
      const d = ENEMIES[e];
      at += d.abilities.includes('swarm') ? 2 : Math.round(Math.max(4, Math.min(10, 8 / d.speed)));
    }
    at += 10; // 1 s entre deux paquets
  }
  return { wave: w, spawns, intro, theme: theme?.name ?? null, boss, mult: hpMult(w) };
}

// --- Simulation d'une vague ---------------------------------------------------------------------

interface Dot {
  dps: number;
  t: number;
  dur: number;
  shred: number;
  plague: number;
  healCut: number;
  maxStacks: number;
}

export interface Enemy {
  uid: number;
  def: number;
  mini: boolean;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  pos: number;
  x: number;
  y: number;
  alive: boolean;
  bounty: number;
  revived: boolean;
  slow: number;
  slowT: number;
  stunT: number;
  frozen: boolean;
  fragile: number;
  fragileT: number;
  dots: Dot[];
  burn: number;
  burnT: number;
  burnPure: boolean;
  noHealT: number;
  sinceHit: number;
  clock: number; // fouisseur, nécromancien, Dévoreur
  clock2: number; // Titan volant, invocations du Dévoreur
  burrowed: boolean;
  airborne: boolean; // Titan v40 : vole par moments
  revealed: boolean;
  phase: number; // boss
  diedAt: number;
}

interface Live {
  t: TowerState;
  st: TowerStats;
  x: number;
  y: number;
  rate: number; // multiplicateur de cadence (aura)
  range: number;
  cd: number;
  shots: number;
  disabledT: number;
  clock: number; // napalm
  beams: { uid: number; time: number }[];
  angle: number;
}

interface Patch {
  x: number;
  y: number;
  r: number;
  dps: number;
  t: number;
}

export interface Hole {
  x: number;
  y: number;
  r: number;
  t: number;
  dur: number;
  pct: number;
  bossPct: number;
  slow: number;
  collapse: number;
  collapseBoss: number;
}

/** Effets visuels d'un tick (ignorés par le serveur). */
export type Fx =
  | { k: 'shot'; tower: number; x: number; y: number }
  | { k: 'chain'; tower: number; pts: [number, number][] }
  | { k: 'boom'; x: number; y: number; r: number; tower: number }
  | { k: 'cone'; tower: number; x: number; y: number; r: number }
  | { k: 'beam'; tower: number; x: number; y: number; w: number }
  | { k: 'death'; x: number; y: number; boss: boolean };

const RAMP = [1, 1.5, 2.25, 3.375];
const isBoss = (e: Enemy) => ENEMIES[e.def].tier === 'boss';
const isElite = (e: Enemy) => ENEMIES[e.def].tier === 'late' || isBoss(e);
const has = (e: Enemy, a: string) => !e.mini && (ENEMIES[e.def].abilities as string[]).includes(a);
const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

export function startWave(s: RunState) {
  const n = s.wave + 1;
  const plan = planWave(s.seed, n);
  const rng = makeRng(subSeed(s.seed, n, 2));
  const mult = plan.mult;
  const titanLevel = Math.min(4, Math.max(1, Math.floor(n / 10)));
  const enemies: Enemy[] = [];
  const dead: Enemy[] = []; // pour le Nécromancien
  const patches: Patch[] = [];
  const holes: Hole[] = [];
  let towers: Live[] = [];
  let fx: Fx[] | null = null;
  let nextSpawn = 0;
  let ticks = 0;
  let done = false;
  let uid = 1;
  for (const t of s.towers) t.fresh = false;

  // --- Tours
  const derive = () => {
    const old = new Map(towers.map((l) => [l.t.id, l]));
    const banners = s.towers.filter((t) => TOWERS[t.kind].id === BANK.id && t.level >= 2);
    const banner = towerStats(BANK, 2);
    towers = s.towers.map((t) => {
      const st = towerStats(TOWERS[t.kind], t.level);
      const x = t.x + 0.5;
      const y = t.y + 0.5;
      const buffed = banners.some((b) => b !== t && dist2(b.x + 0.5, b.y + 0.5, x, y) <= 9);
      const rate = buffed ? 1 + (banner.auraRate ?? 0) : 1;
      const range = st.range * (buffed ? 1 + (banner.auraRange ?? 0) : 1);
      const prev = old.get(t.id);
      return {
        t, st, x, y, rate, range,
        cd: prev?.cd ?? 0, shots: prev?.shots ?? 0, disabledT: prev?.disabledT ?? 0, clock: prev?.clock ?? 0,
        beams: prev?.beams ?? [], angle: prev?.angle ?? -Math.PI / 2,
      };
    });
  };
  derive();

  // --- Ennemis
  const spawn = (def: number, pos: number, opts: { mini?: boolean; hpRatio?: number; bounty?: number; revived?: boolean } = {}) => {
    const d = ENEMIES[def];
    const maxHp = (opts.mini ? MINI.hp : d.hp) * mult;
    let maxShield = (d.shield ?? 0) * mult;
    if (def === TITAN && titanLevel >= 2) maxShield = maxHp * 0.2;
    const [x, y] = pathPos(pos);
    const e: Enemy = {
      uid: uid++, def, mini: Boolean(opts.mini), hp: maxHp * (opts.hpRatio ?? 1), maxHp, shield: maxShield, maxShield, pos, x, y, alive: true,
      bounty: opts.bounty ?? (opts.mini ? MINI.bounty : d.bounty), revived: Boolean(opts.revived), slow: 0, slowT: 0, stunT: 0, frozen: false,
      fragile: 0, fragileT: 0, dots: [], burn: 0, burnT: 0, burnPure: false, noHealT: 0, sinceHit: 0, clock: 0, clock2: 0,
      burrowed: false, airborne: false, revealed: !d.camo, phase: 1, diedAt: 0,
    };
    enemies.push(e);
    return e;
  };

  const flying = (e: Enemy) => ENEMIES[e.def].flying || e.airborne;
  const armorOf = (e: Enemy) => {
    let shred = 0;
    for (const d of e.dots) shred += d.shred;
    return Math.max(0, ENEMIES[e.def].armor - shred);
  };

  const kill = (e: Enemy) => {
    e.alive = false;
    e.diedAt = ticks;
    s.gold += e.bounty;
    s.kills++;
    if (isBoss(e)) s.bossKills++;
    fx?.push({ k: 'death', x: e.x, y: e.y, boss: isBoss(e) });
    if (e.def === SPLITTER && !e.mini) for (let k = 0; k < 3; k++) spawn(SPLITTER, Math.max(0, e.pos - 0.15 * k), { mini: true });
    const plague = e.dots.filter((d) => d.plague > 0);
    if (plague.length) {
      for (const o of enemies) {
        if (!o.alive || dist2(o.x, o.y, e.x, e.y) > plague[0].plague * plague[0].plague) continue;
        for (const d of plague) addDot(o, { ...d, t: d.dur });
      }
    }
    if (!isBoss(e) && !e.revived && !e.mini) dead.push(e);
  };

  const hit = (e: Enemy, dmg: number, type: DamageType, o: { ignoreArmor?: boolean; ignoreMR?: boolean; shieldMult?: number; mult?: number } = {}) => {
    if (!e.alive || dmg <= 0) return;
    const d = ENEMIES[e.def];
    let v = dmg;
    if (type === 'physical') {
      const armor = o.ignoreArmor ? 0 : armorOf(e);
      v = Math.max(v * 0.2, v - armor) * (1 - d.physicalResist);
    } else if (type === 'magic') v *= 1 - (o.ignoreMR ? 0 : d.magicResist);
    v *= o.mult ?? 1;
    if (e.fragileT > 0) v *= 1 + e.fragile;
    e.sinceHit = 0;
    if (e.shield > 0) {
      const sm = o.shieldMult ?? 1;
      const absorbed = Math.min(e.shield, v * sm);
      e.shield -= absorbed;
      v -= absorbed / sm;
    }
    e.hp -= v;
    if (e.hp <= 0) kill(e);
  };

  const heal = (e: Enemy, amount: number) => {
    if (e.noHealT > 0 || !e.alive) return;
    let cut = 0;
    for (const d of e.dots) cut = Math.max(cut, d.healCut);
    e.hp = Math.min(e.maxHp, e.hp + amount * (1 - cut));
  };

  const addDot = (e: Enemy, d: Dot) => {
    if (e.dots.length < d.maxStacks) return void e.dots.push(d);
    let oldest = 0;
    for (let k = 1; k < e.dots.length; k++) if (e.dots[k].t < e.dots[oldest].t) oldest = k;
    e.dots[oldest] = d;
  };

  const slowImmune = (e: Enemy) => has(e, 'immune_slow') || (e.def === DEVOURER && e.phase >= 3);
  const applySlow = (e: Enemy, pct: number, dur: number) => {
    if (slowImmune(e)) return;
    const p = has(e, 'slow_resist') ? pct / 2 : pct;
    if (e.slowT <= 0 || p > e.slow) {
      e.slow = p;
      e.slowT = dur;
    } else if (p === e.slow) e.slowT = Math.max(e.slowT, dur);
  };
  const stun = (e: Enemy, dur: number) => {
    if (isBoss(e)) return;
    e.stunT = Math.max(e.stunT, dur);
    e.frozen = false;
  };
  const freeze = (e: Enemy, dur: number, slow: number) => {
    if (slowImmune(e)) return;
    if (isBoss(e)) return applySlow(e, slow, dur);
    if (has(e, 'slow_resist')) return applySlow(e, 1, dur);
    e.stunT = Math.max(e.stunT, dur);
    e.frozen = true;
  };

  // --- Ciblage
  const targetable = (tw: Live, e: Enemy) => e.alive && !e.burrowed && (!flying(e) || tw.st.hitsAir) && e.revealed;
  const inRange = (tw: Live, e: Enemy, r = tw.range) => dist2(tw.x, tw.y, e.x, e.y) <= r * r;
  const pickTarget = (tw: Live, skip?: Set<number>) => {
    let best: Enemy | null = null;
    for (const e of enemies) {
      if (!targetable(tw, e) || !inRange(tw, e) || skip?.has(e.uid)) continue;
      if (!best) best = e;
      else if (tw.st.targetStrong ? e.hp + e.shield > best.hp + best.shield : e.pos > best.pos) best = e;
    }
    return best;
  };
  const area = (x: number, y: number, r: number, f: (e: Enemy) => void, opts: { air: boolean; buried?: boolean }) => {
    for (const e of enemies) {
      if (!e.alive || (e.burrowed && !opts.buried) || (flying(e) && !opts.air)) continue;
      if (dist2(x, y, e.x, e.y) <= r * r) f(e);
    }
  };
  const aim = (tw: Live, e: Enemy) => (tw.angle = Math.atan2(e.y - tw.y, e.x - tw.x));

  // --- Comportement de chaque tour
  const fire = (tw: Live) => {
    const st = tw.st;
    const kind = TOWERS[tw.t.kind].id;
    const ti = tw.t.id;
    const dt = TICK;
    if (kind === 'bank') return;

    if (kind === 'flamer') {
      const target = pickTarget(tw);
      if (!target) return;
      aim(tw, target);
      const dx = target.x - tw.x;
      const dy = target.y - tw.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      for (const e of enemies) {
        if (!e.alive || e.burrowed || flying(e) || !inRange(tw, e)) continue;
        const ex = e.x - tw.x;
        const ey = e.y - tw.y;
        const el = Math.sqrt(ex * ex + ey * ey) || 1;
        if ((ex * dx + ey * dy) / (el * len) < (st.cone ?? 1)) continue;
        hit(e, st.damage * tw.rate * dt, 'magic', { ignoreMR: st.ignoreMR });
        if (!e.alive) continue;
        e.burn = st.burn ?? 0;
        e.burnT = st.burnDur ?? 0;
        e.burnPure = Boolean(st.ignoreMR);
        if (st.antiHeal) e.noHealT = Math.max(e.noHealT, st.burnDur ?? 0);
      }
      fx?.push({ k: 'cone', tower: ti, x: target.x, y: target.y, r: tw.range });
      if (st.napalm) {
        tw.clock += dt;
        if (tw.clock >= 1) {
          tw.clock -= 1;
          patches.push({ x: target.x, y: target.y, r: 0.7, dps: st.napalm, t: st.napalmDur ?? 3 });
        }
      }
      return;
    }

    if (kind === 'railgun' && st.beam) {
      const count = st.beams ?? 1;
      const taken = new Set<number>();
      tw.beams.length = Math.min(tw.beams.length, count);
      for (let k = 0; k < count; k++) {
        const cur = tw.beams[k];
        let e = cur ? enemies.find((o) => o.uid === cur.uid) : undefined;
        if (!e || !targetable(tw, e) || !inRange(tw, e) || taken.has(e.uid)) {
          e = pickTarget(tw, taken) ?? undefined;
          tw.beams[k] = { uid: e?.uid ?? 0, time: 0 };
        }
        if (!e) continue;
        taken.add(e.uid);
        const b = tw.beams[k];
        const step = Math.floor(b.time + 1e-9);
        const ramp = Math.min(st.rampMax ?? 1, step < RAMP.length ? RAMP[step] : st.rampMax ?? 1);
        if (k === 0) aim(tw, e);
        hit(e, st.beam * (k === 0 ? 1 : st.subRatio ?? 1) * ramp * tw.rate * dt, 'pure');
        b.time += dt;
        fx?.push({ k: 'beam', tower: ti, x: e.x, y: e.y, w: k === 0 ? 1 : 0.6 });
      }
      return;
    }

    if (kind === 'singularity') {
      tw.cd -= dt;
      if (tw.cd > 0) return;
      const target = pickTarget(tw);
      if (!target) {
        tw.cd = 0;
        return;
      }
      aim(tw, target);
      holes.push({
        x: target.x, y: target.y, r: st.holeRadius ?? 1, t: st.holeDur ?? 3, dur: st.holeDur ?? 3, pct: st.holePct ?? 0, bossPct: st.holeBossPct ?? 0,
        slow: st.holeSlow ?? 0, collapse: st.collapse ?? 0, collapseBoss: st.collapseBoss ?? 0,
      });
      tw.cd += (st.holeEvery ?? 6) / tw.rate;
      return;
    }

    tw.cd -= dt;
    if (tw.cd > 0) return;
    const target = pickTarget(tw);
    if (!target) {
      tw.cd = 0;
      return;
    }
    aim(tw, target);
    tw.cd += 1 / (st.fireRate * tw.rate);
    tw.shots++;
    const type = st.damageType ?? 'physical';

    if (kind === 'crossbow') {
      for (let b = 0; b < (st.bolts ?? 1); b++) {
        const victims = [target];
        if ((st.pierce ?? 1) > 1) {
          const near = enemies
            .filter((e) => e !== target && targetable(tw, e) && dist2(e.x, e.y, target.x, target.y) <= 1)
            .sort((a, c) => dist2(a.x, a.y, target.x, target.y) - dist2(c.x, c.y, target.x, target.y) || a.uid - c.uid);
          victims.push(...near.slice(0, (st.pierce ?? 1) - 1));
        }
        for (const e of victims) hit(e, st.damage, type, { mult: st.crit && rng() < st.crit ? st.critMult : 1 });
      }
      fx?.push({ k: 'shot', tower: ti, x: target.x, y: target.y });
    } else if (kind === 'cannon') {
      const x = target.x;
      const y = target.y;
      area(x, y, st.splash ?? 0, (e) => {
        hit(e, st.damage, type);
        if (st.stun && e.alive) stun(e, st.stun);
      }, { air: false });
      fx?.push({ k: 'boom', x, y, r: st.splash ?? 0, tower: ti });
      if (st.frags) {
        for (const [ox, oy] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
          area(x + ox, y + oy, st.fragRadius ?? 0.7, (e) => hit(e, st.frags!, type), { air: false });
          fx?.push({ k: 'boom', x: x + ox, y: y + oy, r: st.fragRadius ?? 0.7, tower: ti });
        }
      }
    } else if (kind === 'frost') {
      const freezing = st.freezeEvery ? tw.shots % st.freezeEvery === 0 : false;
      area(target.x, target.y, st.splash ?? 0, (e) => {
        hit(e, st.damage, type);
        if (!e.alive) return;
        applySlow(e, st.slow ?? 0, st.slowDur ?? 0);
        if (freezing) freeze(e, st.freezeDur ?? 1, st.slow ?? 0);
        if (st.fragile) {
          e.fragile = st.fragile;
          e.fragileT = st.fragileDur ?? 0;
        }
      }, { air: true });
      fx?.push({ k: 'boom', x: target.x, y: target.y, r: st.splash ?? 0, tower: ti });
    } else if (kind === 'alchemist') {
      addDot(target, { dps: st.dot ?? 0, t: st.dotDur ?? 0, dur: st.dotDur ?? 0, shred: st.shred ?? 0, plague: st.plague ?? 0, healCut: st.healCut ?? 0, maxStacks: st.maxStacks ?? 1 });
      fx?.push({ k: 'shot', tower: ti, x: target.x, y: target.y });
    } else if (kind === 'tesla') {
      const hitSet = new Set<number>([target.uid]);
      const pts: [number, number][] = [[tw.x, tw.y], [target.x, target.y]];
      let cur = target;
      const chain = [target];
      while (chain.length < (st.chain ?? 1)) {
        let next: Enemy | null = null;
        let bd = Infinity;
        for (const e of enemies) {
          if (hitSet.has(e.uid) || !targetable(tw, e)) continue;
          const d = dist2(e.x, e.y, cur.x, cur.y);
          if (d <= (st.chainRange ?? 1) * (st.chainRange ?? 1) && d < bd) {
            bd = d;
            next = e;
          }
        }
        if (!next) break;
        hitSet.add(next.uid);
        chain.push(next);
        pts.push([next.x, next.y]);
        cur = next;
      }
      for (const e of chain) {
        hit(e, st.damage, type, { shieldMult: st.shieldMult });
        if (st.paralyze && e.alive && rng() < st.paralyze) stun(e, st.paralyzeDur ?? 1);
      }
      fx?.push({ k: 'chain', tower: ti, pts });
    } else if (kind === 'sniper') {
      hit(target, st.damage, type, { ignoreArmor: st.ignoreArmor, mult: st.eliteMult && isElite(target) ? st.eliteMult : 1 });
      if (st.execute && target.alive && !isBoss(target) && target.hp < target.maxHp * st.execute) {
        target.hp = 0;
        kill(target);
      }
      fx?.push({ k: 'shot', tower: ti, x: target.x, y: target.y });
    } else if (kind === 'railgun') {
      const dx = target.x - tw.x;
      const dy = target.y - tw.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      for (const e of enemies) {
        if (!e.alive || e.burrowed) continue;
        const px = e.x - tw.x;
        const py = e.y - tw.y;
        const along = px * ux + py * uy;
        const across = px * uy - py * ux;
        if (along >= 0 && along <= tw.range && across * across <= (st.line ?? 0.35) * (st.line ?? 0.35)) hit(e, st.damage, 'pure');
      }
      fx?.push({ k: 'shot', tower: ti, x: tw.x + ux * tw.range, y: tw.y + uy * tw.range });
    }
  };

  // --- Un pas de simulation
  function tick(collect?: Fx[]): boolean {
    if (done) return false;
    fx = collect ?? null;
    const dt = TICK;

    while (nextSpawn < plan.spawns.length && plan.spawns[nextSpawn].at <= ticks) spawn(plan.spawns[nextSpawn++].enemy, 0);

    // États, dégâts sur la durée, soins
    for (const e of enemies) {
      if (!e.alive) continue;
      e.sinceHit += dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.stunT > 0) e.stunT -= dt;
      if (e.fragileT > 0) e.fragileT -= dt;
      if (e.noHealT > 0) e.noHealT -= dt;
      if (e.dots.length) {
        for (const d of e.dots) {
          hit(e, d.dps * dt, 'magic');
          d.t -= dt;
        }
        e.dots = e.dots.filter((d) => d.t > 1e-9);
      }
      if (e.alive && e.burnT > 0) {
        hit(e, e.burn * dt, 'magic', { ignoreMR: e.burnPure });
        e.burnT -= dt;
      }
      if (!e.alive) continue;
      const d = ENEMIES[e.def];
      if (d.regen && !e.mini) heal(e, e.maxHp * d.regen * dt);
      if (e.def === TITAN && titanLevel >= 3) heal(e, e.maxHp * 0.01 * dt);
      if (has(e, 'shield') && e.sinceHit >= 4) e.shield = e.maxShield;
      if (has(e, 'burrow')) {
        e.clock += dt;
        if (e.clock >= 5 - 1e-9) e.clock -= 5;
        e.burrowed = e.clock >= 3 - 1e-9;
      }
      if (e.def === TITAN) {
        if (titanLevel >= 4) {
          e.clock2 += dt;
          if (e.clock2 >= 20 - 1e-9) e.clock2 -= 20;
          e.airborne = e.clock2 >= 15 - 1e-9;
        }
        if (e.phase === 1 && e.hp < e.maxHp * 0.5) {
          e.phase = 2;
          for (let k = 0; k < 6; k++) spawn(BRUTE, Math.max(0, e.pos - 0.12 * k));
        }
      }
      if (e.def === DEVOURER) {
        e.clock += dt;
        if (e.clock >= 15 - 1e-9) {
          e.clock -= 15;
          let target: Live | null = null;
          for (const tw of towers) if (tw.disabledT <= 0 && (!target || tw.t.invested > target.t.invested)) target = tw;
          if (target) target.disabledT = 5;
        }
        if (e.phase === 1 && e.hp < e.maxHp * 0.6) {
          e.phase = 2;
          e.shield += e.maxHp * 0.2;
          e.maxShield = Math.max(e.maxShield, e.shield);
        }
        if (e.phase >= 2) {
          e.clock2 += dt;
          if (e.clock2 >= 8 - 1e-9) {
            e.clock2 -= 8;
            spawn(SPECTER, Math.max(0, e.pos - 0.2));
            spawn(SPECTER, Math.max(0, e.pos - 0.4));
          }
        }
        if (e.phase === 2 && e.hp < e.maxHp * 0.25) {
          e.phase = 3;
          e.slowT = 0;
          e.stunT = 0;
        }
      }
    }
    for (const hl of enemies) {
      if (!hl.alive || !has(hl, 'heal_aura')) continue;
      for (const e of enemies) if (e !== hl && e.alive && dist2(e.x, e.y, hl.x, hl.y) <= 4) heal(e, e.maxHp * 0.03 * dt);
    }
    for (const nc of enemies) {
      if (!nc.alive || !has(nc, 'revive')) continue;
      nc.clock += dt;
      if (nc.clock < 6 - 1e-9) continue;
      nc.clock -= 6;
      let raised = 0;
      for (let k = dead.length - 1; k >= 0 && raised < 2; k--) {
        const o = dead[k];
        if (ticks - o.diedAt > 60) continue;
        dead.splice(k, 1);
        const r = spawn(o.def, o.pos, { hpRatio: 0.5, bounty: 0, revived: true });
        r.revealed = !ENEMIES[o.def].camo;
        raised++;
      }
    }

    // Déplacement
    for (const e of enemies) {
      if (!e.alive) continue;
      let speed = e.mini ? MINI.speed : ENEMIES[e.def].speed;
      for (const sh of enemies) {
        if (sh !== e && sh.alive && has(sh, 'speed_aura') && dist2(sh.x, sh.y, e.x, e.y) <= 4) {
          speed *= 1.3;
          break;
        }
      }
      if (e.def === DEVOURER && e.phase >= 3) speed *= 2;
      if (e.slowT > 0) speed *= 1 - e.slow;
      if (e.stunT > 0) speed = 0;
      else e.frozen = false;
      e.pos += speed * dt;
      if (e.pos >= LENGTH) {
        e.alive = false;
        const cost = ENEMIES[e.def].livesCost;
        s.lives = cost < 0 ? 0 : s.lives - cost;
        s.lostTo = ENEMIES[e.def].id;
        continue;
      }
      [e.x, e.y] = pathPos(e.pos);
    }

    // Détection des camouflés
    for (const e of enemies) {
      if (!e.alive || !ENEMIES[e.def].camo) continue;
      e.revealed = towers.some((tw) => tw.st.detectsCamo && tw.disabledT <= 0 && inRange(tw, e));
    }

    // Tours
    for (const tw of towers) {
      if (tw.disabledT > 0) {
        tw.disabledT -= dt;
        continue;
      }
      fire(tw);
    }

    // Sol brûlant et trous noirs
    for (const p of patches) {
      area(p.x, p.y, p.r, (e) => hit(e, p.dps * dt, 'magic'), { air: false, buried: true });
      p.t -= dt;
    }
    for (let k = patches.length - 1; k >= 0; k--) if (patches[k].t <= 1e-9) patches.splice(k, 1);
    for (const hl of holes) {
      area(hl.x, hl.y, hl.r, (e) => {
        hit(e, e.maxHp * (isBoss(e) ? hl.bossPct : hl.pct) * dt, 'pure');
        if (hl.slow && e.alive) applySlow(e, hl.slow, 0.2);
      }, { air: true, buried: true });
      hl.t -= dt;
      if (hl.t <= 1e-9 && hl.collapse) {
        area(hl.x, hl.y, hl.r, (e) => hit(e, e.maxHp * (isBoss(e) ? hl.collapseBoss : hl.collapse), 'pure'), { air: true, buried: true });
        fx?.push({ k: 'boom', x: hl.x, y: hl.y, r: hl.r, tower: 0 });
      }
    }
    for (let k = holes.length - 1; k >= 0; k--) if (holes[k].t <= 1e-9) holes.splice(k, 1);

    // Ménage : les ennemis morts ou passés ne servent plus (sauf pour le Nécromancien, gardés dans `dead`)
    if (ticks % 50 === 0) {
      for (let k = enemies.length - 1; k >= 0; k--) if (!enemies[k].alive) enemies.splice(k, 1);
    }
    for (let k = dead.length - 1; k >= 0; k--) if (ticks - dead[k].diedAt > 60) dead.splice(k, 1);

    ticks++;
    if (s.lives <= 0) {
      s.lives = 0;
      s.over = true;
      done = true;
    } else if (nextSpawn >= plan.spawns.length && !enemies.some((e) => e.alive)) {
      s.wave = n;
      s.lostTo = null;
      let income = waveBonus(n);
      for (const t of s.towers) {
        const st = towerStats(TOWERS[t.kind], t.level);
        if (st.income) income += st.income + Math.min(st.interestCap ?? 0, Math.floor(s.gold * (st.interest ?? 0)));
      }
      s.gold += income;
      done = true;
    } else if (ticks >= MAX_TICKS) {
      s.over = true;
      done = true;
    }
    return !done;
  }

  /** Construction pendant la vague : appliquée avant le prochain tick. Retourne l'erreur éventuelle. */
  function act(a: string): string | null {
    if (done) return 'vague terminée';
    const err = applyAction(s, a, true);
    if (!err) derive();
    return err;
  }

  return {
    plan,
    number: n,
    enemies: () => enemies,
    towers: () => towers,
    holes: () => holes,
    patches: () => patches,
    tick,
    act,
    ticks: () => ticks,
    done: () => done,
  };
}

export type Running = ReturnType<typeof startWave>;

/**
 * Rejoue une vague complète à partir des actions du joueur (`;`-séparées, celles pendant la vague
 * suffixées de @tick). C'est ce que fait le serveur. Lève une erreur si une action est invalide.
 */
export function replayWave(s: RunState, actions: string): number {
  const during: [string, number][] = [];
  let prev = -1;
  for (const a of actions ? actions.split(';') : []) {
    const m = /^([^@]+)(?:@(\d{1,6}))?$/.exec(a);
    if (!m) throw new Error('action invalide');
    if (m[2] === undefined) {
      if (prev >= 0) throw new Error('actions dans le désordre');
      const err = applyAction(s, m[1]);
      if (err) throw new Error(err);
    } else {
      const t = Number(m[2]);
      if (t < prev) throw new Error('actions dans le désordre');
      prev = t;
      during.push([m[1], t]);
    }
  }
  const w = startWave(s);
  let k = 0;
  for (;;) {
    while (k < during.length && during[k][1] === w.ticks()) {
      const err = w.act(during[k][0]);
      if (err) throw new Error(err);
      k++;
    }
    if (!w.tick()) break;
  }
  if (k < during.length) throw new Error('action après la fin de la vague');
  return w.ticks();
}
