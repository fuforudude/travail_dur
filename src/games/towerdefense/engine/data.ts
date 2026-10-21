// Tower defense (campagne de 20 niveaux, puis mode infini) : toutes les valeurs d'équilibrage
// (tours, ennemis, cartes, vagues, économie, déblocages, héros).
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

/** Une voie de spécialisation : choisie au 3e niveau d'amélioration, deux niveaux. */
export interface PathDef {
  name: string;
  ups: [UpgradeDef, UpgradeDef];
}

export interface TowerDef {
  id: string;
  name: string;
  tier: Tier;
  cost: number;
  role: string;
  starter: boolean;
  maxPerMap?: number;
  /** Tour spéciale : posée sur certaines cartes, à débloquer contre de l'or, jamais construite ni améliorée. */
  special?: boolean;
  /** Comportement de tir emprunté à une tour normale (tours spéciales). */
  as?: string;
  stats: TowerStats;
  /** Deux améliorations communes, puis deux voies au choix de deux améliorations chacune. */
  common: [UpgradeDef, UpgradeDef];
  paths: [PathDef, PathDef];
}

const U = (id: string, name: string, cost: number, text: string, set: Partial<TowerStats>): UpgradeDef => ({ id, name, cost, text, set });
const SPECIAL = (id: string, name: string, as: string, role: string, stats: TowerStats): TowerDef => ({
  id, name, as, role, stats, special: true, tier: 'boosted', cost: 0, starter: false,
  common: [] as unknown as TowerDef['common'], paths: [] as unknown as TowerDef['paths'],
});

export const TOWERS: TowerDef[] = [
  {
    id: 'crossbow', name: 'Arbalète', tier: 'early', cost: 100, role: 'Mono-cible rapide', starter: true,
    stats: { damage: 8, damageType: 'physical', fireRate: 1.5, range: 3.5, hitsAir: true, detectsCamo: false },
    common: [
      U('crossbow_c1', 'Cordes renforcées', 50, 'Dégâts 11, portée 3,8', { damage: 11, range: 3.8 }),
      U('crossbow_c2', 'Viseur', 90, 'Dégâts 14, 1,8 tir/s', { damage: 14, fireRate: 1.8 }),
    ],
    paths: [
      { name: 'Perforation', ups: [
        U('crossbow_a1', 'Carreaux perforants', 150, 'Dégâts 20, traverse 3 ennemis', { damage: 20, pierce: 3 }),
        U('crossbow_a2', 'Volée', 300, '3 carreaux par tir, 20 % de critiques ×2, détecte les camouflés', { bolts: 3, crit: 0.2, critMult: 2, detectsCamo: true }),
      ] },
      { name: 'Tir rapide', ups: [
        U('crossbow_b1', 'Répétition', 150, '3,5 tirs/s, détecte les camouflés', { fireRate: 3.5, detectsCamo: true }),
        U('crossbow_b2', 'Gatling', 320, '6 tirs/s, dégâts 18', { fireRate: 6, damage: 18 }),
      ] },
    ],
  },
  {
    id: 'cannon', name: 'Canon', tier: 'early', cost: 150, role: 'Zone', starter: true,
    stats: { damage: 20, damageType: 'physical', fireRate: 0.8, range: 3, hitsAir: false, detectsCamo: false, splash: 1 },
    common: [
      U('cannon_c1', 'Poudre fine', 70, 'Dégâts 28, portée 3,3', { damage: 28, range: 3.3 }),
      U('cannon_c2', 'Fût allongé', 120, 'Dégâts 34, zone 1,2', { damage: 34, splash: 1.2 }),
    ],
    paths: [
      { name: 'Artillerie', ups: [
        U('cannon_a1', 'Obus lourds', 200, 'Dégâts 55, zone 1,5, étourdit 0,3 s', { damage: 55, splash: 1.5, stun: 0.3 }),
        U('cannon_a2', 'Bombe à fragmentation', 350, '4 sous-munitions de 20 dégâts autour de l’impact', { frags: 20, fragRadius: 0.7 }),
      ] },
      { name: 'Mortier', ups: [
        U('cannon_b1', 'Mortier', 200, 'Portée 5, dégâts 45, zone 1,6', { range: 5, damage: 45, splash: 1.6 }),
        U('cannon_b2', 'Pluie d’obus', 380, 'Dégâts 60, 1,4 tir/s', { fireRate: 1.4, damage: 60 }),
      ] },
    ],
  },
  {
    id: 'frost', name: 'Givre', tier: 'early', cost: 120, role: 'Contrôle', starter: true,
    stats: { damage: 4, damageType: 'magic', fireRate: 1, range: 3, hitsAir: true, detectsCamo: false, splash: 0.8, slow: 0.3, slowDur: 2 },
    common: [
      U('frost_c1', 'Cristaux', 60, 'Dégâts 6, ralentit 2,5 s', { damage: 6, slowDur: 2.5 }),
      U('frost_c2', 'Bise', 100, 'Ralentit 40 %, portée 3,4', { slow: 0.4, range: 3.4 }),
    ],
    paths: [
      { name: 'Glace', ups: [
        U('frost_a1', 'Gel profond', 160, 'Ralentit 50 %, gèle 1 s tous les 4 tirs (boss : ralentit)', { damage: 8, slow: 0.5, freezeEvery: 4, freezeDur: 1 }),
        U('frost_a2', 'Zéro absolu', 300, 'Gèle 1,5 s tous les 3 tirs, zone 1,2', { freezeEvery: 3, freezeDur: 1.5, splash: 1.2 }),
      ] },
      { name: 'Brume', ups: [
        U('frost_b1', 'Fragilité', 170, '+20 % de dégâts subis pendant 3 s, détecte les camouflés', { fragile: 0.2, fragileDur: 3, detectsCamo: true }),
        U('frost_b2', 'Malédiction de givre', 320, '+35 % de dégâts subis, portée 4', { fragile: 0.35, range: 4 }),
      ] },
    ],
  },
  {
    id: 'alchemist', name: 'Alchimiste', tier: 'early', cost: 130, role: 'Poison anti-armure', starter: false,
    stats: { damage: 0, damageType: 'magic', fireRate: 1, range: 3, hitsAir: false, detectsCamo: false, dot: 6, dotDur: 4, maxStacks: 3 },
    common: [
      U('alchemist_c1', 'Fioles', 70, 'Poison 8/s', { dot: 8 }),
      U('alchemist_c2', 'Distillation', 110, '4 cumuls, portée 3,4', { maxStacks: 4, range: 3.4 }),
    ],
    paths: [
      { name: 'Corrosion', ups: [
        U('alchemist_a1', 'Acide', 180, 'Poison 12/s, chaque cumul retire 3 d’armure', { dot: 12, shred: 3 }),
        U('alchemist_a2', 'Dissolution', 340, 'Poison 16/s, chaque cumul retire 5 d’armure', { dot: 16, shred: 5 }),
      ] },
      { name: 'Peste', ups: [
        U('alchemist_b1', 'Contagion', 180, 'Se propage à la mort, soins reçus −50 %', { plague: 1.5, healCut: 0.5 }),
        U('alchemist_b2', 'Pandémie', 360, '6 cumuls, propagation 2,2, soins reçus −80 %', { maxStacks: 6, plague: 2.2, healCut: 0.8 }),
      ] },
    ],
  },
  {
    id: 'tesla', name: 'Tesla', tier: 'mid', cost: 400, role: 'Multi-cibles', starter: false,
    stats: { damage: 25, damageType: 'magic', fireRate: 1, range: 3, hitsAir: true, detectsCamo: false, chain: 4, chainRange: 1.5 },
    common: [
      U('tesla_c1', 'Bobines', 200, 'Dégâts 32', { damage: 32 }),
      U('tesla_c2', 'Condensateur', 280, 'Chaîne de 5 cibles, portée 3,4', { chain: 5, range: 3.4 }),
    ],
    paths: [
      { name: 'Surcharge', ups: [
        U('tesla_a1', 'Surcharge', 300, 'Dégâts 45, chaîne de 7 cibles, ×2 contre les boucliers', { damage: 45, chain: 7, shieldMult: 2 }),
        U('tesla_a2', 'Arc géant', 550, 'Dégâts 65, chaîne de 10 cibles, saut 2 cases', { damage: 65, chain: 10, chainRange: 2 }),
      ] },
      { name: 'Tempête', ups: [
        U('tesla_b1', 'Orage', 300, 'Dégâts 50, 15 % de chances de paralyser 1 s', { damage: 50, paralyze: 0.15, paralyzeDur: 1 }),
        U('tesla_b2', 'Foudre', 600, 'Dégâts 80, 25 % de chances de paralyser 1,5 s', { damage: 80, paralyze: 0.25, paralyzeDur: 1.5 }),
      ] },
    ],
  },
  {
    id: 'sniper', name: 'Sniper', tier: 'mid', cost: 450, role: 'Burst, détecte', starter: false,
    stats: { damage: 120, damageType: 'physical', fireRate: 0.67, range: 99, hitsAir: true, detectsCamo: true, targetStrong: true },
    common: [
      U('sniper_c1', 'Lunette', 250, 'Dégâts 160', { damage: 160 }),
      U('sniper_c2', 'Culasse', 300, '0,85 tir/s', { fireRate: 0.85 }),
    ],
    paths: [
      { name: 'Gros calibre', ups: [
        U('sniper_a1', 'Calibre .50', 400, 'Dégâts 260, ignore l’armure', { damage: 260, ignoreArmor: true }),
        U('sniper_a2', 'Point faible', 700, 'Exécute sous 15 % PV, ×2 contre élites et boss', { execute: 0.15, eliteMult: 2 }),
      ] },
      { name: 'Commando', ups: [
        U('sniper_b1', 'Semi-auto', 400, 'Dégâts 140, 1,6 tir/s', { damage: 140, fireRate: 1.6 }),
        U('sniper_b2', 'Balles traçantes', 650, '2,2 tirs/s, 25 % de critiques ×3', { fireRate: 2.2, crit: 0.25, critMult: 3 }),
      ] },
    ],
  },
  {
    id: 'flamer', name: 'Lance-flammes', tier: 'mid', cost: 350, role: 'Anti-essaim', starter: false,
    stats: { damage: 30, damageType: 'magic', fireRate: 0, range: 2, hitsAir: false, detectsCamo: false, cone: 0.866, burn: 10, burnDur: 3 },
    common: [
      U('flamer_c1', 'Réservoir', 180, '38/s', { damage: 38 }),
      U('flamer_c2', 'Buse large', 250, 'Portée 2,4', { range: 2.4 }),
    ],
    paths: [
      { name: 'Napalm', ups: [
        U('flamer_a1', 'Napalm', 280, '55/s, sol brûlant 3 s (touche les enterrés)', { damage: 55, napalm: 20, napalmDur: 3 }),
        U('flamer_a2', 'Enfer', 500, '70/s, sol brûlant 40/s pendant 4 s', { damage: 70, napalm: 40, napalmDur: 4 }),
      ] },
      { name: 'Feu bleu', ups: [
        U('flamer_b1', 'Flamme bleue', 300, '75/s, ignore la résistance magique', { damage: 75, ignoreMR: true }),
        U('flamer_b2', 'Purification', 600, '100/s, brûlure 25/s, empêche les soins', { damage: 100, burn: 25, antiHeal: true }),
      ] },
    ],
  },
  {
    id: 'bank', name: 'Comptoir', tier: 'mid', cost: 300, role: 'Économie, soutien', starter: false, maxPerMap: 3,
    stats: { damage: 0, damageType: null, fireRate: 0, range: 0, hitsAir: false, detectsCamo: false, income: 40 },
    common: [
      U('bank_c1', 'Coffre', 150, '+55 or par vague', { income: 55 }),
      U('bank_c2', 'Guichet', 200, '+70 or par vague', { income: 70 }),
    ],
    paths: [
      { name: 'Finance', ups: [
        U('bank_a1', 'Intérêts', 300, '+90 or par vague, + 5 % de l’or possédé (200 max)', { income: 90, interest: 0.05, interestCap: 200 }),
        U('bank_a2', 'Bourse', 500, '+ 8 % de l’or possédé (400 max)', { interest: 0.08, interestCap: 400 }),
      ] },
      { name: 'Bannière', ups: [
        U('bank_b1', 'Bannière de guerre', 300, 'Aura 3 cases : +20 % de cadence, +10 % de portée', { aura: 3, auraRate: 0.2, auraRange: 0.1 }),
        U('bank_b2', 'Étendard', 550, 'Aura : +35 % de cadence, +20 % de portée', { auraRate: 0.35, auraRange: 0.2 }),
      ] },
    ],
  },
  {
    id: 'railgun', name: 'Railgun', tier: 'boosted', cost: 1500, role: 'Perforation', starter: false, maxPerMap: 2,
    stats: { damage: 600, damageType: 'pure', fireRate: 0.4, range: 6, hitsAir: true, detectsCamo: false, line: 0.35 },
    common: [
      U('railgun_c1', 'Bobinage', 700, 'Dégâts 800', { damage: 800 }),
      U('railgun_c2', 'Refroidissement', 900, '0,55 tir/s', { fireRate: 0.55 }),
    ],
    paths: [
      { name: 'Faisceau', ups: [
        U('railgun_a1', 'Faisceau continu', 1000, 'Rayon 150/s, ×1,5 par seconde sur la même cible (×4 max)', { beam: 150, rampMax: 4, beams: 1 }),
        U('railgun_a2', 'Prisme', 2000, '3 rayons, les 2 secondaires à 60 %', { beams: 3, subRatio: 0.6 }),
      ] },
      { name: 'Canon à rail', ups: [
        U('railgun_b1', 'Surcharge', 1100, 'Dégâts 1 400, trait plus large', { damage: 1400, line: 0.5 }),
        U('railgun_b2', 'Accélérateur', 1900, 'Dégâts 2 400, 0,7 tir/s', { damage: 2400, fireRate: 0.7 }),
      ] },
    ],
  },
  {
    id: 'singularity', name: 'Singularité', tier: 'boosted', cost: 2000, role: 'Anti-tank, anti-boss', starter: false, maxPerMap: 1,
    stats: {
      damage: 0, damageType: 'pure', fireRate: 0, range: 4, hitsAir: true, detectsCamo: false,
      holeEvery: 6, holeDur: 3, holeRadius: 1.3, holePct: 0.04, holeBossPct: 0.01,
    },
    common: [
      U('singularity_c1', 'Gravité', 800, '5 % des PV max par seconde', { holePct: 0.05 }),
      U('singularity_c2', 'Stabilisateur', 1000, 'Un trou noir toutes les 5 s', { holeEvery: 5 }),
    ],
    paths: [
      { name: 'Horizon', ups: [
        U('singularity_a1', 'Horizon des événements', 1500, 'Rayon 2,5, dure 4 s, ralentit 60 %', { holeRadius: 2.5, holeDur: 4, holeSlow: 0.6 }),
        U('singularity_a2', 'Annihilation', 3000, 'Explose en s’effondrant : 15 % des PV max (boss 5 %)', { collapse: 0.15, collapseBoss: 0.05 }),
      ] },
      { name: 'Distorsion', ups: [
        U('singularity_b1', 'Puits', 1500, '7 % des PV max par seconde (boss 2 %)', { holePct: 0.07, holeBossPct: 0.02 }),
        U('singularity_b2', 'Trou blanc', 2800, 'Un trou noir toutes les 3,5 s (boss 3 %)', { holeEvery: 3.5, holeBossPct: 0.03 }),
      ] },
    ],
  },
  // Tours spéciales (après les 10 tours normales : jamais dans la boutique ni dans les caisses).
  SPECIAL('trebuchet', 'Trébuchet antique', 'cannon', 'Zone, très longue portée', {
    damage: 140, damageType: 'physical', fireRate: 0.35, range: 7.5, hitsAir: false, detectsCamo: false, splash: 1.5, stun: 0.6,
  }),
  SPECIAL('phare', 'Phare', 'frost', 'Ralentit et révèle', {
    damage: 12, damageType: 'magic', fireRate: 1, range: 4.5, hitsAir: true, detectsCamo: true, splash: 2, slow: 0.45, slowDur: 2,
  }),
  SPECIAL('paratonnerre', 'Paratonnerre', 'tesla', 'Éclairs en chaîne', {
    damage: 70, damageType: 'magic', fireRate: 1.2, range: 4.5, hitsAir: true, detectsCamo: false, chain: 6, chainRange: 2.2, shieldMult: 2,
  }),
  SPECIAL('baliste', 'Grande baliste', 'crossbow', 'Perce tout, détecte', {
    damage: 110, damageType: 'physical', fireRate: 1.4, range: 6, hitsAir: true, detectsCamo: true, pierce: 5, ignoreArmor: true,
  }),
  SPECIAL('puits', 'Puits sans fond', 'singularity', 'Trous noirs', {
    damage: 0, damageType: 'pure', fireRate: 0, range: 5, hitsAir: true, detectsCamo: false,
    holeEvery: 4, holeDur: 3, holeRadius: 1.6, holePct: 0.06, holeBossPct: 0.02, holeSlow: 0.4,
  }),
];

/** Niveaux d'une tour : 0 base, 1 et 2 améliorations communes, 3 et 4 dans la voie choisie. */
export const MAX_LEVEL = 4;

/** Amélioration qui fait passer du niveau `level` au suivant (dans la voie `path` à partir du 3e). */
export function upgradeAt(def: TowerDef, level: number, path: number | null): UpgradeDef | null {
  if (def.special) return null;
  if (level < 2) return def.common[level];
  if (level >= MAX_LEVEL || path === null || path < 0) return null;
  return def.paths[path].ups[level - 2];
}

/** Caractéristiques d'une tour à son niveau (et dans sa voie). */
export function towerStats(def: TowerDef, level: number, path: number | null = null): TowerStats {
  let s = def.stats;
  if (def.special) return s;
  for (let i = 0; i < Math.min(level, 2); i++) s = { ...s, ...def.common[i].set };
  if (path !== null && path >= 0) for (let i = 0; i < level - 2; i++) s = { ...s, ...def.paths[path].ups[i].set };
  return s;
}

export type Ability =
  | 'swarm' | 'heal_aura' | 'shield' | 'split' | 'regen' | 'speed_aura' | 'burrow'
  | 'slow_resist' | 'immune_slow' | 'revive' | 'titan' | 'devourer' | 'youg' | 'martine';

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
  // Titan : armure 5 à sa première apparition (vague 10), +2 à chacune des suivantes (sim.ts).
  // Réglé avec un joueur automatique (tours de départ seulement) : il passe la vague 10, la vague 20 reste un vrai défi.
  E({ id: 'titan', name: 'Titan', tier: 'boss', firstWave: 10, hp: 2000, speed: 0.4, armor: 5, abilities: ['titan'], bounty: 500, threat: 0, livesCost: 12, text: 'Invoque des Brutes à mi-vie (3, puis 6), plus fort à chaque apparition', counters: 'Tout ce qui frappe fort' }),
  E({ id: 'devourer', name: 'Bagou', tier: 'boss', firstWave: 50, hp: 15000, speed: 0.35, armor: 12, abilities: ['devourer'], bounty: 3000, threat: 0, livesCost: -1, text: 'Fan de Linux : « kill -9 » sur votre meilleure tour, creuse des tunnels pour son escorte, bouclier, puis fonce', counters: 'Singularité, Railgun, Sniper U2' }),
  // Chapitre 2, la chasse à la sorcière (niveaux 26 à 75).
  E({ id: 'youg', name: 'Youg', tier: 'boss', firstWave: 999, hp: 9500, speed: 0.5, armor: 10, abilities: ['youg'], bounty: 2500, threat: 0, livesCost: 15, text: 'Rat géant : fait surgir des nuées de rats, enragé à mi-vie (plus rapide, insensible au gel)', counters: 'Lance-flammes, Canon, Tesla contre les rats ; Railgun, Sniper contre lui' }),
  E({ id: 'martine', name: 'Martine', tier: 'boss', firstWave: 999, hp: 18000, speed: 0.38, armor: 8, abilities: ['martine'], bounty: 5000, threat: 0, livesCost: -1, text: 'Sorcière : change votre meilleure tour en crapaud, s’envole sur son balai, se téléporte et appelle des rats', counters: 'Tours anti-aériennes, Singularité, Railgun' }),
];

/** Mini-scindeur : n'apparaît qu'à la mort d'un Scindeur. */
export const MINI = { hp: 50, speed: 1.4, bounty: 4 };

// --- Cartes -------------------------------------------------------------------------------------

export const COLS = 16;
export const ROWS = 10;

type Pt = [number, number];

/** Chemin case par case à partir de points de passage alignés deux à deux. */
function route(...pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    let [x, y] = out[out.length - 1];
    const [tx, ty] = pts[k];
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x);
      y += Math.sign(ty - y);
      out.push([x, y]);
    }
  }
  return out;
}

/** Tour spéciale posée sur une carte : `cost` or pour la débloquer, dégâts × `power`. */
export interface SpecialSpot {
  x: number;
  y: number;
  tower: string;
  cost: number;
  power: number;
}

/**
 * Une carte : sa taille et ses routes, chacune d'une entrée à une sortie. Plusieurs routes peuvent
 * partager une entrée (bifurcation), une sortie (jonction) ou un tronçon ; les ennemis se répartissent
 * entre elles, paquet par paquet.
 */
export interface MapDef {
  w: number;
  h: number;
  routes: Pt[][];
  special?: SpecialSpot;
}

const M = (routes: Pt[][], o: Partial<MapDef> = {}): MapDef => ({ w: COLS, h: ROWS, routes, ...o });
const spot = (x: number, y: number, tower: string, cost: number, power = 1): SpecialSpot => ({ x, y, tower, cost, power });

/** Carte 0 : le mode infini. Cartes 1 à 20 : la campagne ; 21 à 25 : les niveaux bonus. */
export const MAPS: MapDef[] = [
  M([route([0, 2], [4, 2], [4, 7], [9, 7], [9, 2], [13, 2], [13, 7], [15, 7])]),
  // Acte I
  M([route([0, 5], [6, 5], [6, 2], [11, 2], [11, 6], [15, 6])]),
  M([route([0, 1], [4, 1], [4, 8], [10, 8], [10, 3], [15, 3])], { special: spot(7, 5, 'phare', 250) }),
  M([route([0, 8], [3, 8], [3, 2], [8, 2], [8, 7], [12, 7], [12, 1], [15, 1])]),
  M([ // deux entrées
    route([7, 0], [7, 4], [2, 4], [2, 8], [13, 8], [13, 3], [15, 3]),
    route([0, 1], [10, 1], [10, 8], [13, 8], [13, 3], [15, 3]),
  ]),
  M([route([0, 2], [13, 2], [13, 5], [2, 5], [2, 8], [15, 8])], { special: spot(7, 7, 'trebuchet', 400, 1.2) }),
  M([ // deux sorties
    route([0, 7], [5, 7], [5, 1], [10, 1], [10, 8], [15, 8]),
    route([0, 7], [5, 7], [5, 1], [15, 1]),
  ]),
  M([route([19, 1], [14, 1], [14, 10], [8, 10], [8, 3], [3, 3], [3, 9], [0, 9])], { w: 20, h: 12 }),
  // Acte II
  M([ // deux entrées, deux sorties
    route([0, 4], [3, 4], [3, 1], [7, 1], [7, 8], [11, 8], [11, 4], [15, 4]),
    route([0, 9], [5, 9], [5, 6], [13, 6], [13, 0]),
  ], { special: spot(9, 4, 'paratonnerre', 500) }),
  M([route([2, 0], [2, 6], [6, 6], [6, 2], [10, 2], [10, 8], [14, 8], [14, 0])]),
  M([
    route([0, 2], [6, 2], [6, 8], [12, 8], [12, 4], [19, 4]),
    route([0, 10], [9, 10], [9, 8], [12, 8], [12, 4], [19, 4]),
  ], { w: 20, h: 12 }),
  M([ // trois entrées
    route([0, 1], [10, 1], [10, 6], [15, 6], [15, 9], [19, 9]),
    route([0, 11], [10, 11], [10, 6], [15, 6], [15, 9], [19, 9]),
    route([0, 6], [5, 6], [5, 3], [10, 3], [10, 6], [15, 6], [15, 9], [19, 9]),
  ], { w: 20, h: 12 }),
  M([route([0, 8], [2, 8], [2, 1], [5, 1], [5, 8], [8, 8], [8, 1], [11, 1], [11, 8], [15, 8])], { special: spot(13, 4, 'baliste', 600, 1.3) }),
  M([ // trois sorties
    route([0, 5], [6, 5], [6, 1], [19, 1]),
    route([0, 5], [6, 5], [6, 10], [19, 10]),
    route([0, 5], [12, 5], [12, 7], [19, 7]),
  ], { w: 20, h: 12 }),
  M([
    route([0, 2], [8, 2], [8, 10], [21, 10]),
    route([21, 2], [14, 2], [14, 6], [3, 6], [3, 12]),
  ], { w: 22, h: 13, special: spot(11, 4, 'phare', 400, 1.5) }),
  // Acte III
  M([
    route([0, 3], [7, 3], [7, 9], [14, 9], [14, 5], [19, 5]),
    route([10, 0], [10, 9], [14, 9], [14, 5], [19, 5]),
  ], { w: 20, h: 12, special: spot(11, 6, 'puits', 900) }),
  M([route([0, 1], [13, 1], [13, 3], [2, 3], [2, 5], [13, 5], [13, 7], [2, 7], [2, 9], [15, 9])]),
  M([ // quatre entrées
    route([0, 1], [14, 1], [14, 6], [17, 6], [17, 9], [21, 9]),
    route([0, 11], [14, 11], [14, 6], [17, 6], [17, 9], [21, 9]),
    route([0, 6], [6, 6], [6, 3], [10, 3], [10, 6], [17, 6], [17, 9], [21, 9]),
    route([7, 12], [7, 9], [11, 9], [11, 6], [17, 6], [17, 9], [21, 9]),
  ], { w: 22, h: 13 }),
  M([
    route([0, 2], [10, 2], [10, 5], [16, 5], [16, 10], [19, 10]),
    route([0, 9], [6, 9], [6, 5], [16, 5], [16, 10], [19, 10]),
  ], { w: 20, h: 12, special: spot(8, 7, 'baliste', 600, 1.8) }),
  M([ // trois entrées, deux sorties
    route([0, 2], [10, 2], [10, 6], [16, 6], [16, 12]),
    route([0, 10], [10, 10], [10, 6], [21, 6]),
    route([5, 0], [5, 4], [10, 4], [10, 6], [21, 6]),
  ], { w: 22, h: 13 }),
  M([
    route([0, 2], [6, 2], [6, 10], [12, 10], [12, 4], [18, 4], [18, 10], [21, 10]),
    route([21, 0], [15, 0], [15, 2], [9, 2], [9, 7], [12, 7], [12, 4], [18, 4], [18, 10], [21, 10]),
  ], { w: 22, h: 13, special: spot(15, 7, 'puits', 1000, 1.2) }),
  // Niveaux bonus
  M([route([0, 5], [5, 5], [5, 2], [10, 2], [10, 7], [15, 7])]),
  M([
    route([0, 1], [9, 1], [9, 10], [19, 10]),
    route([19, 1], [13, 1], [13, 6], [9, 6], [9, 10], [19, 10]),
  ], { w: 20, h: 12 }),
  M([
    route([0, 6], [8, 6], [8, 9], [14, 9], [14, 6], [21, 6]),
    route([8, 0], [8, 9], [14, 9], [14, 6], [21, 6]),
    route([21, 12], [18, 12], [18, 9], [14, 9], [14, 6], [21, 6]),
  ], { w: 22, h: 13 }),
  M([
    route([0, 1], [6, 1], [6, 6], [10, 6], [15, 6], [15, 9], [19, 9]),
    route([0, 11], [6, 11], [6, 6], [10, 6], [15, 6], [15, 9], [19, 9]),
    route([19, 0], [12, 0], [12, 3], [10, 3], [10, 6], [15, 6], [15, 9], [19, 9]),
    route([0, 6], [3, 6], [3, 8], [10, 8], [10, 6], [15, 6], [15, 9], [19, 9]),
  ], { w: 20, h: 12, special: spot(8, 4, 'trebuchet', 900, 2) }),
  M([
    route([0, 1], [10, 1], [10, 6], [21, 6]),
    route([0, 11], [10, 11], [10, 6], [16, 6], [16, 12]),
    route([21, 0], [13, 0], [13, 4], [7, 4], [7, 8], [10, 8], [10, 6], [21, 6]),
    route([21, 12], [19, 12], [19, 9], [13, 9], [13, 6], [16, 6], [16, 12]),
  ], { w: 22, h: 13, special: spot(14, 8, 'puits', 1200, 1.5) }),
];

/**
 * Cartes du chapitre 2 (niveaux 26 à 75) : générées à partir du numéro du niveau, donc identiques
 * partout. Une route principale en serpentin de gauche à droite ; selon le niveau, des entrées en plus
 * (par le haut ou le bas, qui rejoignent la route), une 2e sortie, une tour spéciale, et une taille
 * de 16 × 10 à 22 × 13. Vérifiées par scripts/sql-test.mjs… et par la boucle de contrôle des cartes.
 */
const SPECIAL_TOWERS = ['phare', 'trebuchet', 'paratonnerre', 'baliste', 'puits'];
function chapter2Map(k: number): MapDef {
  let seed = (k * 2654435761) >>> 0;
  const rnd = (n: number) => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % n) | 0;
  };
  const sizes: [number, number][] = [[16, 10], [18, 11], [20, 12], [22, 13]];
  const [w, h] = sizes[Math.min(3, Math.floor((k - 1) / 13) + rnd(2))];
  // Route principale : de (0, y) au bord droit, en serpentin (x croissant : jamais sur elle-même).
  const turns = 3 + rnd(3);
  const xs: number[] = [];
  for (let i = 1; i <= turns; i++) xs.push(Math.round((i * (w - 2)) / (turns + 1)));
  for (let i = 1; i < xs.length; i++) if (xs[i] <= xs[i - 1] + 1) xs[i] = xs[i - 1] + 2;
  const pts: Pt[] = [];
  let y = 1 + rnd(h - 2);
  pts.push([0, y]);
  for (const x of xs) {
    pts.push([x, y]);
    // Aller vers l'autre moitié de la carte, pour un long chemin.
    const ny = y < h / 2 ? Math.floor(h / 2) + rnd(Math.ceil(h / 2) - 1) : 1 + rnd(Math.floor(h / 2) - 1);
    y = Math.max(1, Math.min(h - 2, ny === y ? (y + 3) % (h - 2) + 1 : ny));
    pts.push([x, y]);
  }
  pts.push([w - 1, y]);
  const main = route(...pts);
  const routes: Pt[][] = [main];
  // Entrées en plus (0 à 2) : par le haut ou le bas, elles rejoignent un tronçon horizontal de la route.
  const extra = k % 4 === 0 || k % 6 === 0 ? 2 : k % 3 === 0 ? 1 : 0; // 3 entrées au plus
  // Une entrée trop courte serait injouable : 22 cases au moins, sinon un autre essai.
  for (let e = 0; e < extra; e++) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const seg = rnd(Math.max(1, Math.floor(pts.length / 2) - 1)) * 2 + 1; // tronçon horizontal pts[seg-1] → pts[seg]
      const [ax, ay] = pts[seg - 1];
      const [bx] = pts[seg];
      const edge = (e + attempt) % 2 === 0 ? 0 : h - 1;
      if (bx - ax < 2 || Math.abs(edge - ay) < 2) continue;
      const x = ax + 1 + rnd(bx - ax - 1);
      const r = route([x, edge], [x, ay], ...pts.slice(seg));
      if (r.length - 1 >= 22) {
        routes.push(r);
        break;
      }
    }
  }
  // Deuxième sortie : un niveau sur cinq, la route se sépare vers le haut ou le bas.
  if (k % 5 === 0 && pts.length >= 6) {
    // Bifurcation tardive (avant-dernier virage) : l'essentiel du chemin reste commun et défendable.
    let j = pts.length - 3;
    if (j % 2 === 0) j--;
    const [x, yy] = pts[j];
    const edge = yy < h / 2 ? h - 1 : 0;
    const r = route(...pts.slice(0, j + 1), [x, edge]);
    if (r.length - 1 >= 20) routes.push(r);
  }
  const map: MapDef = { w, h, routes };
  // Tour spéciale, un niveau sur trois : sur une case libre près du centre.
  if (k % 3 === 1) {
    const taken = new Set(routes.flatMap((r) => r.map(([x, yy]) => yy * w + x)));
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    for (let d = 0; d < 6 && !map.special; d++)
      for (let dy = -d; dy <= d && !map.special; dy++)
        for (let dx = -d; dx <= d && !map.special; dx++) {
          const x = cx + dx;
          const yy = cy + dy;
          if (x > 0 && yy > 0 && x < w - 1 && yy < h - 1 && !taken.has(yy * w + x)) {
            map.special = spot(x, yy, SPECIAL_TOWERS[k % SPECIAL_TOWERS.length], 600 + 20 * k, 1.5 + k * 0.03);
          }
        }
  }
  return map;
}
for (let k = 1; k <= 50; k++) MAPS[25 + k] = chapter2Map(k);

/** Carte d'index `m` (le mode infini si elle n'existe pas). */
export const mapOf = (m: number) => MAPS[m] ?? MAPS[0];

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

// --- Campagne ---------------------------------------------------------------------------------

export const LEVEL_COUNT = 20;

/**
 * Niveaux bonus (21 à 25), les défis de Tonton Jean-Mi : débloqués après le niveau `unlock` de la
 * campagne, chacun avec sa règle qui pique. `lives` remplace les vies de départ (héros compris),
 * `hp`, `speed` et `cost` multiplient les PV et la vitesse des ennemis et le prix des tours.
 */
export interface BonusLevel {
  unlock: number;
  waves: number;
  offset: number;
  rule: string;
  lives?: number;
  hp?: number;
  speed?: number;
  cost?: number;
  boss: 'titan' | 'devourer' | null;
}

export const BONUS: BonusLevel[] = [
  { unlock: 4, waves: 10, offset: 9, lives: 1, boss: null, rule: 'Une seule vie' },
  { unlock: 8, waves: 11, offset: 18, speed: 1.5, hp: 1.1, boss: null, rule: 'Ennemis +50 % de vitesse' },
  { unlock: 12, waves: 12, offset: 22, hp: 1.35, boss: 'titan', rule: 'Ennemis +35 % de PV, Titan au maximum' },
  { unlock: 16, waves: 12, offset: 27, cost: 1.4, boss: null, rule: 'Tours et améliorations +40 %' },
  { unlock: 20, waves: 16, offset: 32, lives: 8, hp: 1.2, speed: 1.1, boss: 'devourer', rule: '8 vies, ennemis +20 % de PV et +10 % de vitesse' },
];
export const BONUS_COUNT = BONUS.length;
/** Niveau bonus L (21 à 25), ou null pour un niveau de la campagne. */
export const bonusLevel = (L: number): BonusLevel | null => (L > LEVEL_COUNT ? BONUS[L - LEVEL_COUNT - 1] ?? null : null);

/**
 * Chapitre 2, la chasse à la sorcière : niveaux 26 à 75 (numéros après les défis bonus), débloqués
 * après le niveau 20, dans l'ordre. Youg (le rat) au niveau 50, Martine (la sorcière) au 75.
 */
export const CHAPTER2_FIRST = 26;
export const CHAPTER2_COUNT = 50;
export const CHAPTER2_LAST = CHAPTER2_FIRST + CHAPTER2_COUNT - 1;
export const inChapter2 = (L: number) => L >= CHAPTER2_FIRST && L <= CHAPTER2_LAST;
/** Rang dans le chapitre 2 (1 à 50). */
const ch2 = (L: number) => L - CHAPTER2_FIRST + 1;

/** Nombre de vagues du niveau L : 6 à 16 (campagne), 10 à 20 (chapitre 2). */
export const levelWaves = (L: number) => bonusLevel(L)?.waves ?? (inChapter2(L) ? 10 + Math.floor(ch2(L) / 5) : 6 + Math.floor(L / 2));

/** Décalage de difficulté du niveau L : sa vague w vaut la vague levelOffset(L) + w du mode infini. */
export const levelOffset = (L: number) => bonusLevel(L)?.offset ?? (inChapter2(L) ? 18 + Math.floor(ch2(L) * 0.3) : Math.floor(1.6 * (L - 1)));
/**
 * Difficulté d'une vague de campagne, exprimée comme une vague du mode infini (la dernière vague
 * du niveau 20 vaut la vague 46).
 */
export const levelWave = (L: number, w: number) => levelOffset(L) + w;

/**
 * Boss à la dernière vague : niveaux 5, 10 et 15 (le Titan) et 20 (Bagou) ; chapitre 2 : un Titan tous
 * les 10 niveaux, Youg au milieu (niveau 50), Martine à la fin (75).
 */
export type BossId = 'titan' | 'devourer' | 'youg' | 'martine';
export const levelBoss = (L: number): BossId | null => {
  const b = bonusLevel(L);
  if (b) return b.boss;
  if (inChapter2(L)) {
    const k = ch2(L);
    return k === 25 ? 'youg' : k === CHAPTER2_COUNT ? 'martine' : k % 10 === 0 ? 'titan' : null;
  }
  return L === LEVEL_COUNT ? 'devourer' : L % 5 === 0 ? 'titan' : null;
};

/**
 * Or de départ d'un niveau : environ les trois quarts de ce qu'un joueur du mode infini a gagné
 * (or et tours) en arrivant à la même difficulté.
 */
export function levelGold(L: number): number {
  const o = levelOffset(L);
  // Plusieurs entrées ou sorties : il faut défendre plus de terrain, on donne un peu plus d'or.
  const routes = mapOf(L).routes;
  const ends = (k: 0 | 1) => new Set(routes.map((r) => String(k ? r[r.length - 1] : r[0]))).size;
  // Chapitre 2 : de plus grandes cartes à couvrir, 25 % d'or en plus.
  const extra = (1 + 0.2 * (ends(0) - 1) + 0.12 * (ends(1) - 1)) * (inChapter2(L) ? 1.25 : 1);
  return START_GOLD + 10 * Math.round((0.65 * (105 * o + 7 * o * o) * extra) / 10);
}

// --- Étoiles et boutique à étoiles -------------------------------------------------------------

/** Étoiles d'un niveau réussi : 3 sans perdre de vie, 2 avec au moins la moitié, 1 sinon. */
export const starsFor = (lives: number, startLives: number) => (lives >= startLives ? 3 : 2 * lives >= startLives ? 2 : 1);
export const MAX_STARS = 3 * (LEVEL_COUNT + BONUS_COUNT + CHAPTER2_COUNT);

export interface PerkDef {
  id: string;
  name: string;
  text: (n: number) => string;
  bonus: (n: number) => Partial<HeroBonus>;
}

/** Améliorations permanentes de la boutique à étoiles : 5 rangs, le rang n coûte n étoiles. */
export const PERK_MAX = 5;
export const perkCost = (rank: number) => rank;
export const PERKS: PerkDef[] = [
  { id: 'damage', name: 'Poudre de perlimpinpin', text: (n) => `Tours +${3 * n} % de dégâts`, bonus: (n) => ({ damageMult: 1 + 0.03 * n }) },
  { id: 'rate', name: 'Huile de coude', text: (n) => `Tours +${3 * n} % de cadence`, bonus: (n) => ({ rateMult: 1 + 0.03 * n }) },
  { id: 'range', name: 'Lunettes du grand-père', text: (n) => `Tours +${2 * n} % de portée`, bonus: (n) => ({ rangeMult: 1 + 0.02 * n }) },
  { id: 'cost', name: 'Copain du forgeron', text: (n) => `Tours et améliorations −${2 * n} %`, bonus: (n) => ({ costMult: 1 - 0.02 * n }) },
  { id: 'gold', name: 'Bas de laine', text: (n) => `+${30 * n} or au départ`, bonus: (n) => ({ startGold: 30 * n }) },
];
export type Perks = Record<string, number>;
/** Rang valide d'une amélioration (0 si inconnue). */
export const perkRank = (perks: Perks | undefined, id: string) => {
  const n = Number(perks?.[id] ?? 0);
  return Number.isInteger(n) ? Math.max(0, Math.min(PERK_MAX, n)) : 0;
};

// --- Déblocages (nombre de niveaux de la campagne terminés) ------------------------------------

/** Tours : disponibles une fois ce nombre de niveaux terminés. */
export const TOWER_UNLOCK: Record<string, number> = {
  crossbow: 0, cannon: 0, frost: 0, alchemist: 2, tesla: 4, sniper: 6, flamer: 8, bank: 10, railgun: 13, singularity: 16,
};

/** Niveau d'amélioration maximal (1 à 4) selon le nombre de niveaux terminés. */
export const TIER_UNLOCK = [0, 1, 3, 5, 9]; // niveau 1 dès 1 niveau terminé, 2 dès 3, voie dès 5, voie 2 dès 9
export const maxTier = (cleared: number) => TIER_UNLOCK.filter((n) => cleared >= n).length - 1;
export const towersFor = (cleared: number) => TOWERS.filter((t) => cleared >= (TOWER_UNLOCK[t.id] ?? 99)).map((t) => t.id);

// --- Héros ------------------------------------------------------------------------------------

export interface HeroBonus {
  costMult: number; // prix des tours et améliorations
  speedMult: number; // vitesse des ennemis
  rateMult: number; // cadence des tours
  damageMult: number; // dégâts des tours
  rangeMult: number; // portée des tours
  bountyMult: number; // or gagné par ennemi tué
  waveGoldMult: number; // or de fin de vague
  startGold: number;
  lives: number;
}

export const NO_BONUS: HeroBonus = { costMult: 1, speedMult: 1, rateMult: 1, damageMult: 1, rangeMult: 1, bountyMult: 1, waveGoldMult: 1, startGold: 0, lives: 0 };

export const HERO_MAX_LEVEL = 5;

export interface HeroDef {
  id: string;
  name: string;
  title: string;
  /** Effet au niveau n (1 à 5). */
  text: (n: number) => string;
  bonus: (n: number) => Partial<HeroBonus>;
}

export const HEROES: HeroDef[] = [
  { id: 'bricolette', name: 'Bricolette', title: 'la radine', text: (n) => `Tours et améliorations −${4 * n} %`, bonus: (n) => ({ costMult: 1 - 0.04 * n }) },
  { id: 'frigo', name: 'Frigo', title: 'le congelé', text: (n) => `Ennemis −${3 * n} % de vitesse`, bonus: (n) => ({ speedMult: 1 - 0.03 * n }) },
  { id: 'turbo', name: 'Turbo', title: 'qui a bu trop de café', text: (n) => `Tours +${4 * n} % de cadence`, bonus: (n) => ({ rateMult: 1 + 0.04 * n }) },
  { id: 'cogneur', name: 'Cogneur', title: 'qui tape d’abord', text: (n) => `Tours +${5 * n} % de dégâts`, bonus: (n) => ({ damageMult: 1 + 0.05 * n }) },
  { id: 'grippesou', name: 'Grippesou', title: 'le banquier', text: (n) => `+${40 * n} or au départ, +${5 * n} % d’or par vague`, bonus: (n) => ({ startGold: 40 * n, waveGoldMult: 1 + 0.05 * n }) },
  { id: 'pansement', name: 'Doc Pansement', title: 'qui soigne tout avec du scotch', text: (n) => `+${2 * n} vies`, bonus: (n) => ({ lives: 2 * n }) },
  { id: 'longuevue', name: 'Longue-Vue', title: 'qui voit tout (sauf ses lunettes)', text: (n) => `Tours +${3 * n} % de portée`, bonus: (n) => ({ rangeMult: 1 + 0.03 * n }) },
  { id: 'laprime', name: 'La Prime', title: 'chasseuse de primes', text: (n) => `+${8 * n} % d’or par ennemi tué`, bonus: (n) => ({ bountyMult: 1 + 0.08 * n }) },
];

export function heroBonus(hero: { id: string; level: number } | null): HeroBonus {
  const def = hero ? HEROES.find((h) => h.id === hero.id) : undefined;
  if (!def || !hero) return NO_BONUS;
  return { ...NO_BONUS, ...def.bonus(Math.max(1, Math.min(HERO_MAX_LEVEL, hero.level))) };
}

/** Bonus d'une partie : héros, boutique à étoiles et règle du niveau bonus, cumulés. */
export function runBonus(hero: { id: string; level: number } | null, perks: Perks | undefined, level: number): HeroBonus {
  const b = { ...heroBonus(hero) };
  for (const p of PERKS) {
    const n = perkRank(perks, p.id);
    if (!n) continue;
    const e = p.bonus(n);
    b.costMult *= e.costMult ?? 1;
    b.rateMult *= e.rateMult ?? 1;
    b.damageMult *= e.damageMult ?? 1;
    b.rangeMult *= e.rangeMult ?? 1;
    b.startGold += e.startGold ?? 0;
  }
  const bonus = bonusLevel(level);
  if (bonus) {
    b.costMult *= bonus.cost ?? 1;
    b.speedMult *= bonus.speed ?? 1;
  }
  return b;
}
