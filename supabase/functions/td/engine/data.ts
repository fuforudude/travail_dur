// Copie de src/games/towerdefense/engine/data.ts (scripts/td-sync.mjs) : ne pas modifier ici.
// Tower defense roguelike : toutes les valeurs d'équilibrage (tours, ennemis, vagues, économie).
// Partagé tel quel avec la fonction serveur (supabase/functions/td) : pas de DOM, imports en `.ts`.
// Unités : distances en cases, temps en secondes, cadence en tirs par seconde.

export type DamageType = 'physical' | 'magic' | 'pure';
export type Tier = 'early' | 'mid' | 'boosted';
export type EnemyTier = 'early' | 'mid' | 'late' | 'boss';

/** Caractéristiques d'une tour à un niveau donné (base, puis modifiées par chaque amélioration). */
export interface TowerStats {
  damage: number;
  damageType: DamageType | null;
  fireRate: number; // tirs/s ; 0 = continu (dégâts par seconde)
  range: number;
  hitsAir: boolean;
  detectsCamo: boolean;
  // zone et contrôle
  splash?: number; // rayon de la zone autour de l'impact
  stun?: number; // étourdissement (s)
  frags?: number; // dégâts de chacune des 4 sous-munitions
  fragRadius?: number;
  slow?: number; // 0..1
  slowDur?: number;
  freezeEvery?: number; // gèle tous les n tirs
  freezeDur?: number;
  fragile?: number; // bonus de dégâts subis, 0..1
  fragileDur?: number;
  // mono-cible
  pierce?: number; // nombre d'ennemis traversés
  bolts?: number; // projectiles par tir
  crit?: number; // chance de critique 0..1
  critMult?: number;
  ignoreArmor?: boolean;
  execute?: number; // exécute les non-boss sous ce ratio de PV
  eliteMult?: number; // multiplicateur contre élites et boss
  targetStrong?: boolean; // vise l'ennemi le plus résistant plutôt que le plus avancé
  // poison
  dot?: number; // dégâts/s d'un cumul
  dotDur?: number;
  maxStacks?: number;
  shred?: number; // armure retirée par cumul
  plague?: number; // rayon de propagation à la mort
  healCut?: number; // soins reçus × (1 − healCut)
  // électricité
  chain?: number; // cibles touchées au total
  chainRange?: number;
  shieldMult?: number;
  paralyze?: number; // chance par cible
  paralyzeDur?: number;
  // flammes
  cone?: number; // cosinus du demi-angle du cône
  burn?: number;
  burnDur?: number;
  napalm?: number; // dégâts/s du sol brûlant
  napalmDur?: number;
  ignoreMR?: boolean;
  antiHeal?: boolean;
  // économie et soutien
  income?: number; // or par vague
  interest?: number; // part de l'or possédé, par vague
  interestCap?: number;
  aura?: number; // rayon de l'aura
  auraRate?: number;
  auraRange?: number;
  // rail
  line?: number; // largeur du trait qui perce toute la ligne
  beam?: number; // dégâts/s du rayon continu
  rampMax?: number;
  beams?: number;
  subRatio?: number;
  // singularité
  holeEvery?: number;
  holeDur?: number;
  holeRadius?: number;
  holePct?: number; // part des PV max par seconde
  holeBossPct?: number;
  holeSlow?: number;
  collapse?: number; // part des PV max à l'effondrement
  collapseBoss?: number;
}

export interface UpgradeDef {
  id: string;
  name: string;
  cost: number;
  text: string;
  set: Partial<TowerStats>;
}

export interface TowerDef {
  id: string;
  name: string;
  tier: Tier;
  cost: number;
  role: string;
  starter: boolean;
  maxPerMap?: number;
  stats: TowerStats;
  upgrades: [UpgradeDef, UpgradeDef];
}

export const TOWERS: TowerDef[] = [
  {
    id: 'crossbow', name: 'Arbalète', tier: 'early', cost: 100, role: 'Mono-cible rapide', starter: true,
    stats: { damage: 8, damageType: 'physical', fireRate: 1.5, range: 3.5, hitsAir: true, detectsCamo: false },
    upgrades: [
      { id: 'crossbow_u1', name: 'Carreaux perforants', cost: 75, text: 'Dégâts 14, traverse 3 ennemis', set: { damage: 14, pierce: 3 } },
      { id: 'crossbow_u2', name: 'Volée', cost: 200, text: '3 carreaux par tir, 20 % de critiques ×2, détecte les camouflés', set: { bolts: 3, crit: 0.2, critMult: 2, detectsCamo: true } },
    ],
  },
  {
    id: 'cannon', name: 'Canon', tier: 'early', cost: 150, role: 'Zone', starter: true,
    stats: { damage: 20, damageType: 'physical', fireRate: 0.8, range: 3, hitsAir: false, detectsCamo: false, splash: 1 },
    upgrades: [
      { id: 'cannon_u1', name: 'Obus lourds', cost: 120, text: 'Dégâts 40, zone 1,5, étourdit 0,3 s', set: { damage: 40, splash: 1.5, stun: 0.3 } },
      { id: 'cannon_u2', name: 'Bombe à fragmentation', cost: 250, text: '4 sous-munitions de 15 dégâts autour de l’impact', set: { frags: 15, fragRadius: 0.7 } },
    ],
  },
  {
    id: 'frost', name: 'Givre', tier: 'early', cost: 120, role: 'Contrôle', starter: true,
    stats: { damage: 4, damageType: 'magic', fireRate: 1, range: 3, hitsAir: true, detectsCamo: false, splash: 0.8, slow: 0.3, slowDur: 2 },
    upgrades: [
      { id: 'frost_u1', name: 'Gel profond', cost: 100, text: 'Ralentit 50 %, gèle 1 s tous les 4 tirs (boss : ralentit)', set: { damage: 6, slow: 0.5, freezeEvery: 4, freezeDur: 1 } },
      { id: 'frost_u2', name: 'Fragilité', cost: 220, text: '+20 % de dégâts subis pendant 3 s, détecte les camouflés', set: { fragile: 0.2, fragileDur: 3, detectsCamo: true } },
    ],
  },
  {
    id: 'alchemist', name: 'Alchimiste', tier: 'early', cost: 130, role: 'Poison anti-armure', starter: false,
    stats: { damage: 0, damageType: 'magic', fireRate: 1, range: 3, hitsAir: false, detectsCamo: false, dot: 6, dotDur: 4, maxStacks: 3 },
    upgrades: [
      { id: 'alchemist_u1', name: 'Corrosion', cost: 110, text: 'Poison 10/s, chaque cumul retire 3 d’armure', set: { dot: 10, shred: 3 } },
      { id: 'alchemist_u2', name: 'Peste', cost: 240, text: '5 cumuls, le poison se propage à la mort, soins reçus −50 %', set: { maxStacks: 5, plague: 1.5, healCut: 0.5 } },
    ],
  },
  {
    id: 'tesla', name: 'Tesla', tier: 'mid', cost: 400, role: 'Multi-cibles', starter: false,
    stats: { damage: 25, damageType: 'magic', fireRate: 1, range: 3, hitsAir: true, detectsCamo: false, chain: 4, chainRange: 1.5 },
    upgrades: [
      { id: 'tesla_u1', name: 'Surcharge', cost: 300, text: 'Dégâts 40, chaîne de 7 cibles, ×2 contre les boucliers', set: { damage: 40, chain: 7, shieldMult: 2 } },
      { id: 'tesla_u2', name: 'Tempête', cost: 600, text: 'Dégâts 60, 15 % de chances de paralyser 1 s', set: { damage: 60, paralyze: 0.15, paralyzeDur: 1 } },
    ],
  },
  {
    id: 'sniper', name: 'Sniper', tier: 'mid', cost: 450, role: 'Burst, détecte', starter: false,
    stats: { damage: 120, damageType: 'physical', fireRate: 0.67, range: 99, hitsAir: true, detectsCamo: true, targetStrong: true },
    upgrades: [
      { id: 'sniper_u1', name: 'Calibre .50', cost: 350, text: 'Dégâts 250, ignore l’armure', set: { damage: 250, ignoreArmor: true } },
      { id: 'sniper_u2', name: 'Point faible', cost: 700, text: 'Exécute sous 15 % PV, ×2 contre élites et boss', set: { execute: 0.15, eliteMult: 2 } },
    ],
  },
  {
    id: 'flamer', name: 'Lance-flammes', tier: 'mid', cost: 350, role: 'Anti-essaim', starter: false,
    stats: { damage: 30, damageType: 'magic', fireRate: 0, range: 2, hitsAir: false, detectsCamo: false, cone: 0.866, burn: 10, burnDur: 3 },
    upgrades: [
      { id: 'flamer_u1', name: 'Napalm', cost: 300, text: '50/s, sol brûlant 3 s (touche les enterrés)', set: { damage: 50, napalm: 20, napalmDur: 3 } },
      { id: 'flamer_u2', name: 'Feu bleu', cost: 600, text: '90/s, ignore la résistance magique, empêche les soins', set: { damage: 90, ignoreMR: true, antiHeal: true } },
    ],
  },
  {
    id: 'bank', name: 'Comptoir', tier: 'mid', cost: 300, role: 'Économie, soutien', starter: false, maxPerMap: 3,
    stats: { damage: 0, damageType: null, fireRate: 0, range: 0, hitsAir: false, detectsCamo: false, income: 40 },
    upgrades: [
      { id: 'bank_u1', name: 'Intérêts', cost: 250, text: '+60 or par vague, + 5 % de l’or possédé (200 max)', set: { income: 60, interest: 0.05, interestCap: 200 } },
      { id: 'bank_u2', name: 'Bannière de guerre', cost: 500, text: 'Aura 3 cases : +20 % de cadence, +10 % de portée', set: { aura: 3, auraRate: 0.2, auraRange: 0.1 } },
    ],
  },
  {
    id: 'railgun', name: 'Railgun', tier: 'boosted', cost: 1500, role: 'Perforation', starter: false, maxPerMap: 2,
    stats: { damage: 600, damageType: 'pure', fireRate: 0.4, range: 6, hitsAir: true, detectsCamo: false, line: 0.35 },
    upgrades: [
      { id: 'railgun_u1', name: 'Faisceau continu', cost: 1000, text: 'Rayon 150/s, ×1,5 par seconde sur la même cible (×4 max)', set: { beam: 150, rampMax: 4, beams: 1 } },
      { id: 'railgun_u2', name: 'Prisme', cost: 2000, text: '3 rayons, les 2 secondaires à 60 %', set: { beams: 3, subRatio: 0.6 } },
    ],
  },
  {
    id: 'singularity', name: 'Singularité', tier: 'boosted', cost: 2000, role: 'Anti-tank, anti-boss', starter: false, maxPerMap: 1,
    stats: {
      damage: 0, damageType: 'pure', fireRate: 0, range: 4, hitsAir: true, detectsCamo: false,
      holeEvery: 6, holeDur: 3, holeRadius: 1.3, holePct: 0.04, holeBossPct: 0.01,
    },
    upgrades: [
      { id: 'singularity_u1', name: 'Horizon des événements', cost: 1500, text: 'Rayon 2,5, dure 4 s, ralentit 60 %', set: { holeRadius: 2.5, holeDur: 4, holeSlow: 0.6 } },
      { id: 'singularity_u2', name: 'Annihilation', cost: 3000, text: 'Explose en s’effondrant : 15 % des PV max (boss 5 %)', set: { collapse: 0.15, collapseBoss: 0.05 } },
    ],
  },
];

export const towerById = (id: string) => TOWERS.find((t) => t.id === id);

/** Caractéristiques d'une tour au niveau 0 (base), 1 (U1) ou 2 (U2). */
export function towerStats(def: TowerDef, level: number): TowerStats {
  let s = def.stats;
  for (let i = 0; i < level; i++) s = { ...s, ...def.upgrades[i].set };
  return s;
}

export type Ability =
  | 'swarm' | 'heal_aura' | 'shield' | 'split' | 'regen' | 'speed_aura' | 'burrow'
  | 'slow_resist' | 'immune_slow' | 'revive' | 'titan' | 'devourer';

export interface EnemyDef {
  id: string;
  name: string;
  tier: EnemyTier;
  firstWave: number;
  hp: number;
  speed: number;
  armor: number;
  magicResist: number;
  physicalResist: number;
  flying: boolean;
  camo: boolean;
  abilities: Ability[];
  shield?: number;
  regen?: number; // part des PV max par seconde
  bounty: number;
  threat: number;
  livesCost: number; // -1 = fin de partie
  text: string; // capacité
  counters: string;
}

const E = (d: Partial<EnemyDef> & Pick<EnemyDef, 'id' | 'name' | 'tier' | 'firstWave' | 'hp' | 'speed' | 'bounty' | 'threat' | 'livesCost' | 'text' | 'counters'>): EnemyDef => ({
  armor: 0, magicResist: 0, physicalResist: 0, flying: false, camo: false, abilities: [], ...d,
});

export const ENEMIES: EnemyDef[] = [
  E({ id: 'prowler', name: 'Rôdeur', tier: 'early', firstWave: 1, hp: 40, speed: 1, bounty: 5, threat: 1, livesCost: 1, text: 'Ennemi de base', counters: 'Tout' }),
  E({ id: 'runner', name: 'Coureur', tier: 'early', firstWave: 3, hp: 25, speed: 2, bounty: 5, threat: 1, livesCost: 1, text: 'Rapide', counters: 'Givre, Arbalète' }),
  E({ id: 'brute', name: 'Brute', tier: 'early', firstWave: 5, hp: 150, speed: 0.7, armor: 2, bounty: 15, threat: 3, livesCost: 2, text: 'Résistante', counters: 'Canon U1, Alchimiste' }),
  E({ id: 'larva', name: 'Larves', tier: 'early', firstWave: 7, hp: 12, speed: 1.4, abilities: ['swarm'], bounty: 1, threat: 0.3, livesCost: 1, text: 'Arrivent par groupes de 15', counters: 'Canon, Lance-flammes, Tesla' }),
  E({ id: 'bat', name: 'Chauve-souris', tier: 'early', firstWave: 8, hp: 35, speed: 1.6, flying: true, bounty: 6, threat: 1.5, livesCost: 1, text: 'Volante', counters: 'Arbalète, Givre, Tesla' }),
  E({ id: 'armored', name: 'Blindé', tier: 'mid', firstWave: 11, hp: 200, speed: 0.8, armor: 8, bounty: 20, threat: 5, livesCost: 2, text: 'Armure lourde', counters: 'Alchimiste U1, dégâts magiques, Sniper U1' }),
  E({ id: 'shade', name: 'Ombre', tier: 'mid', firstWave: 13, hp: 80, speed: 1.3, camo: true, bounty: 12, threat: 3, livesCost: 1, text: 'Camouflée', counters: 'Sniper, Arbalète U2, Givre U2' }),
  E({ id: 'healer', name: 'Guérisseur', tier: 'mid', firstWave: 15, hp: 120, speed: 0.9, armor: 1, abilities: ['heal_aura'], bounty: 18, threat: 5, livesCost: 1, text: 'Soigne 3 % PV max/s autour de lui', counters: 'Sniper, Alchimiste U2, Feu bleu' }),
  E({ id: 'shieldbearer', name: 'Porte-bouclier', tier: 'mid', firstWave: 16, hp: 100, shield: 150, speed: 1, abilities: ['shield'], bounty: 20, threat: 5, livesCost: 1, text: 'Bouclier rechargé après 4 s sans dégâts', counters: 'Tesla U1, tirs rapides' }),
  E({ id: 'splitter', name: 'Scindeur', tier: 'mid', firstWave: 18, hp: 180, speed: 1, abilities: ['split'], bounty: 10, threat: 5, livesCost: 1, text: 'Se divise en 3 à sa mort', counters: 'Canon, Tesla, Lance-flammes' }),
  E({ id: 'troll', name: 'Troll', tier: 'mid', firstWave: 20, hp: 400, speed: 0.8, armor: 3, abilities: ['regen'], regen: 0.02, bounty: 30, threat: 10, livesCost: 2, text: 'Régénère 2 % PV max/s', counters: 'Sniper, anti-soin' }),
  E({ id: 'shaman', name: 'Chaman de guerre', tier: 'mid', firstWave: 22, hp: 150, speed: 0.9, abilities: ['speed_aura'], bounty: 25, threat: 6, livesCost: 1, text: '+30 % de vitesse aux alliés proches', counters: 'Sniper, Givre' }),
  E({ id: 'burrower', name: 'Fouisseur', tier: 'mid', firstWave: 24, hp: 250, speed: 1.1, armor: 2, abilities: ['burrow'], bounty: 25, threat: 7, livesCost: 2, text: 'S’enterre 2 s toutes les 5 s', counters: 'Napalm, Singularité' }),
  E({ id: 'colossus', name: 'Colosse', tier: 'late', firstWave: 27, hp: 1500, speed: 0.5, armor: 15, abilities: ['slow_resist'], bounty: 80, threat: 25, livesCost: 5, text: 'Ralentissements moitié moins efficaces', counters: 'Dégâts purs, Sniper U1, Singularité' }),
  E({ id: 'specter', name: 'Spectre', tier: 'late', firstWave: 30, hp: 300, speed: 1.2, physicalResist: 0.75, bounty: 35, threat: 9, livesCost: 2, text: 'Résiste à 75 % des dégâts physiques', counters: 'Magique, pur' }),
  E({ id: 'golem', name: 'Golem de givre', tier: 'late', firstWave: 32, hp: 1200, speed: 0.6, armor: 6, magicResist: 0.3, abilities: ['immune_slow'], bounty: 70, threat: 22, livesCost: 4, text: 'Insensible au gel, résiste à la magie', counters: 'Physique, pur, Feu bleu' }),
  E({ id: 'wyvern', name: 'Wyverne', tier: 'late', firstWave: 35, hp: 900, speed: 1.3, armor: 10, flying: true, bounty: 60, threat: 18, livesCost: 3, text: 'Volante et blindée', counters: 'Sniper U1, Railgun, Tesla' }),
  E({ id: 'necromancer', name: 'Nécromancien', tier: 'late', firstWave: 38, hp: 700, speed: 0.8, armor: 2, camo: true, abilities: ['revive'], bounty: 90, threat: 20, livesCost: 3, text: 'Camouflé, ressuscite 2 alliés toutes les 6 s', counters: 'Détection + burst, Sniper U2' }),
  E({ id: 'titan', name: 'Titan', tier: 'boss', firstWave: 10, hp: 3000, speed: 0.4, armor: 10, abilities: ['titan'], bounty: 500, threat: 0, livesCost: 20, text: 'Invoque 6 Brutes à mi-vie, plus fort à chaque apparition', counters: 'Tout ce qui frappe fort' }),
  E({ id: 'devourer', name: 'Le Dévoreur', tier: 'boss', firstWave: 50, hp: 15000, speed: 0.35, armor: 12, abilities: ['devourer'], bounty: 3000, threat: 0, livesCost: -1, text: 'Désactive vos tours, bouclier, puis fonce', counters: 'Singularité, Railgun, Sniper U2' }),
];

export const enemyIndex = (id: string) => ENEMIES.findIndex((e) => e.id === id);
/** Mini-scindeur : n'apparaît qu'à la mort d'un Scindeur. */
export const MINI = { hp: 50, speed: 1.4, bounty: 4 };

// --- Carte ------------------------------------------------------------------------------------

export const COLS = 16;
export const ROWS = 10;

/** Chemin des ennemis, case par case (30 pas). */
export const PATH: [number, number][] = (() => {
  const p: [number, number][] = [];
  for (let x = 0; x <= 4; x++) p.push([x, 2]);
  for (let y = 3; y <= 7; y++) p.push([4, y]);
  for (let x = 5; x <= 9; x++) p.push([x, 7]);
  for (let y = 6; y >= 2; y--) p.push([9, y]);
  for (let x = 10; x <= 13; x++) p.push([x, 2]);
  for (let y = 3; y <= 7; y++) p.push([13, y]);
  for (let x = 14; x <= 15; x++) p.push([x, 7]);
  return p;
})();
export const LENGTH = PATH.length - 1;

// --- Partie -----------------------------------------------------------------------------------

export const START_GOLD = 300;
export const START_LIVES = 20;
export const FINAL_WAVE = 50;
export const SELL_RATIO = 0.7;
export const waveBonus = (w: number) => 50 + 10 * w;

/** Multiplicateur de PV de la vague w. */
export function hpMult(w: number): number {
  if (w <= FINAL_WAVE) return 1 + 0.12 * w + 0.0025 * w * w;
  let m = 1 + 0.12 * FINAL_WAVE + 0.0025 * FINAL_WAVE * FINAL_WAVE;
  for (let i = FINAL_WAVE; i < w; i++) m *= 1.08;
  return m;
}

/** Budget de menace de la vague w. */
export const waveBudget = (w: number) => 8 + 3 * w + 0.08 * w * w;

export const tierOfWave = (w: number): EnemyTier => (w <= 10 ? 'early' : w <= 25 ? 'mid' : 'late');

/** Vagues thématiques (5, 15, 25…) : un seul contre est mis à l'épreuve. */
export const THEMES: { name: string; enemies: string[] }[] = [
  { name: 'Ruée', enemies: ['runner'] },
  { name: 'Nuée volante', enemies: ['bat', 'wyvern'] },
  { name: 'Ombres', enemies: ['shade', 'necromancer'] },
  { name: 'Mur d’acier', enemies: ['armored', 'brute', 'colossus'] },
  { name: 'Essaim', enemies: ['larva', 'splitter'] },
];
export const themeOf = (w: number) => (w % 5 === 0 && w % 10 !== 0 ? THEMES[((w - 5) / 10) % THEMES.length] : null);

// --- Méta-progression -------------------------------------------------------------------------

/** Débloqué d'office : les 3 tours de départ et leur première amélioration. */
export const FREE_ITEMS = ['crossbow', 'cannon', 'frost', 'crossbow_u1', 'cannon_u1', 'frost_u1'];

/** Emplacements de deck : 3, puis +1 aux records de vague 15, 30 et 45. */
export const deckSlots = (bestWave: number) => 3 + (bestWave >= 15 ? 1 : 0) + (bestWave >= 30 ? 1 : 0) + (bestWave >= 45 ? 1 : 0);
