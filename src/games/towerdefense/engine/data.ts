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
  stats: TowerStats;
  /** Deux améliorations communes, puis deux voies au choix de deux améliorations chacune. */
  common: [UpgradeDef, UpgradeDef];
  paths: [PathDef, PathDef];
}

const U = (id: string, name: string, cost: number, text: string, set: Partial<TowerStats>): UpgradeDef => ({ id, name, cost, text, set });

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
];

export const towerById = (id: string) => TOWERS.find((t) => t.id === id);

/** Niveaux d'une tour : 0 base, 1 et 2 améliorations communes, 3 et 4 dans la voie choisie. */
export const MAX_LEVEL = 4;

/** Amélioration qui fait passer du niveau `level` au suivant (dans la voie `path` à partir du 3e). */
export function upgradeAt(def: TowerDef, level: number, path: number | null): UpgradeDef | null {
  if (level < 2) return def.common[level];
  if (level >= MAX_LEVEL || path === null || path < 0) return null;
  return def.paths[path].ups[level - 2];
}

/** Caractéristiques d'une tour à son niveau (et dans sa voie). */
export function towerStats(def: TowerDef, level: number, path: number | null = null): TowerStats {
  let s = def.stats;
  for (let i = 0; i < Math.min(level, 2); i++) s = { ...s, ...def.common[i].set };
  if (path !== null && path >= 0) for (let i = 0; i < level - 2; i++) s = { ...s, ...def.paths[path].ups[i].set };
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
  // Titan : armure 5 à sa première apparition (vague 10), +2 à chacune des suivantes (sim.ts).
  // Réglé avec un joueur automatique (tours de départ seulement) : il passe la vague 10, la vague 20 reste un vrai défi.
  E({ id: 'titan', name: 'Titan', tier: 'boss', firstWave: 10, hp: 2000, speed: 0.4, armor: 5, abilities: ['titan'], bounty: 500, threat: 0, livesCost: 12, text: 'Invoque des Brutes à mi-vie (3, puis 6), plus fort à chaque apparition', counters: 'Tout ce qui frappe fort' }),
  E({ id: 'devourer', name: 'Bagou', tier: 'boss', firstWave: 50, hp: 15000, speed: 0.35, armor: 12, abilities: ['devourer'], bounty: 3000, threat: 0, livesCost: -1, text: 'Fan de Linux : « kill -9 » sur votre meilleure tour, creuse des tunnels pour son escorte, bouclier, puis fonce', counters: 'Singularité, Railgun, Sniper U2' }),
];

export const enemyIndex = (id: string) => ENEMIES.findIndex((e) => e.id === id);
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

/** Carte 0 : le mode infini. Cartes 1 à 20 : les niveaux de la campagne (vérifiées par les tests). */
export const MAPS: Pt[][] = [
  route([0, 2], [4, 2], [4, 7], [9, 7], [9, 2], [13, 2], [13, 7], [15, 7]),
  route([0, 5], [6, 5], [6, 2], [11, 2], [11, 6], [15, 6]),
  route([0, 1], [4, 1], [4, 8], [10, 8], [10, 3], [15, 3]),
  route([0, 8], [3, 8], [3, 2], [8, 2], [8, 7], [12, 7], [12, 1], [15, 1]),
  route([7, 0], [7, 4], [2, 4], [2, 8], [13, 8], [13, 3], [15, 3]),
  route([0, 2], [13, 2], [13, 5], [2, 5], [2, 8], [15, 8]),
  route([0, 7], [5, 7], [5, 1], [10, 1], [10, 8], [15, 8]),
  route([15, 1], [10, 1], [10, 5], [3, 5], [3, 1], [0, 1]),
  route([0, 4], [3, 4], [3, 1], [7, 1], [7, 8], [11, 8], [11, 4], [15, 4]),
  route([2, 0], [2, 6], [6, 6], [6, 2], [10, 2], [10, 8], [14, 8], [14, 0]),
  route([0, 1], [14, 1], [14, 4], [1, 4], [1, 7], [15, 7]),
  route([0, 8], [2, 8], [2, 1], [5, 1], [5, 8], [8, 8], [8, 1], [11, 1], [11, 8], [15, 8]),
  route([8, 0], [8, 3], [3, 3], [3, 7], [12, 7], [12, 2], [15, 2]),
  route([0, 3], [5, 3], [5, 6], [9, 6], [9, 2], [13, 2], [13, 8], [15, 8]),
  route([0, 6], [3, 6], [3, 2], [12, 2], [12, 6], [15, 6]),
  route([0, 1], [13, 1], [13, 3], [2, 3], [2, 5], [13, 5], [13, 7], [2, 7], [2, 9], [15, 9]),
  route([15, 5], [11, 5], [11, 1], [6, 1], [6, 8], [1, 8], [1, 3], [0, 3]),
  route([0, 2], [4, 2], [4, 7], [8, 7], [8, 4], [12, 4], [12, 8], [15, 8]),
  route([7, 9], [7, 6], [2, 6], [2, 2], [12, 2], [12, 6], [15, 6]),
  route([0, 8], [6, 8], [6, 4], [1, 4], [1, 1], [10, 1], [10, 6], [15, 6]),
  route([0, 1], [14, 1], [14, 3], [1, 3], [1, 6], [14, 6], [14, 8], [0, 8]),
];

/** Compatibilité : la carte du mode infini. */
export const PATH = MAPS[0];

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

/** Nombre de vagues du niveau L (1 à 20) : 6 au début, 16 au dernier. */
export const levelWaves = (L: number) => 6 + Math.floor(L / 2);

/** Décalage de difficulté du niveau L : sa vague w vaut la vague levelOffset(L) + w du mode infini. */
export const levelOffset = (L: number) => Math.floor(1.6 * (L - 1));
/**
 * Difficulté d'une vague de campagne, exprimée comme une vague du mode infini (la dernière vague
 * du niveau 20 vaut la vague 46).
 */
export const levelWave = (L: number, w: number) => levelOffset(L) + w;

/** Boss à la dernière vague des niveaux 5, 10 et 15 (le Titan, de plus en plus fort) et 20 (Bagou). */
export const levelBoss = (L: number): 'titan' | 'devourer' | null => (L === LEVEL_COUNT ? 'devourer' : L % 5 === 0 ? 'titan' : null);

/**
 * Or de départ d'un niveau : environ les trois quarts de ce qu'un joueur du mode infini a gagné
 * (or et tours) en arrivant à la même difficulté.
 */
export function levelGold(L: number): number {
  const o = levelOffset(L);
  return START_GOLD + 10 * Math.round((0.65 * (105 * o + 7 * o * o)) / 10);
}

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
