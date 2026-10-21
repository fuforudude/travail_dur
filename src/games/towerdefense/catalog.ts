// Tower defense : catalogue des caisses (héros, finitions des skins).
// À garder identique à supabase/migrations/0030_td_roguelike.sql et 0032_td_campagne.sql
// (td_crates, td_catalog).

import { ENEMIES, HEROES, TOWERS } from './engine/data';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITY_NAMES: Record<Rarity, string> = { common: 'Commun', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire', mythic: 'Mythique' };
export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic'];

export interface Finish {
  id: string;
  name: string;
  rarity: Rarity;
  body: string;
  edge: string;
  glow?: string;
  anim?: 'rainbow' | 'pulse' | 'flicker';
  alpha?: number;
}

export const TOWER_FINISHES: Finish[] = [
  { id: 'wood', name: 'Bois', rarity: 'common', body: '#a8743f', edge: '#5e3b1c' },
  { id: 'stone', name: 'Pierre', rarity: 'common', body: '#a3a39b', edge: '#5c5c56' },
  { id: 'copper', name: 'Cuivre', rarity: 'common', body: '#cf7d3f', edge: '#7a3f17' },
  { id: 'jade', name: 'Jade', rarity: 'rare', body: '#3fae7a', edge: '#1d6b47' },
  { id: 'ruby', name: 'Rubis', rarity: 'rare', body: '#d2364b', edge: '#7d1424' },
  { id: 'gold', name: 'Or', rarity: 'epic', body: '#e6b422', edge: '#8a6a0a', glow: '#ffd86b' },
  { id: 'obsidian', name: 'Obsidienne', rarity: 'epic', body: '#2a2533', edge: '#8b5cf6', glow: '#8b5cf6' },
  { id: 'neon', name: 'Néon', rarity: 'legendary', body: '#19e3ff', edge: '#0a6b80', glow: '#19e3ff', anim: 'pulse' },
  { id: 'lava', name: 'Lave', rarity: 'legendary', body: '#ff5a1f', edge: '#6b1405', glow: '#ff8a3d', anim: 'flicker' },
  { id: 'prism', name: 'Prisme', rarity: 'mythic', body: '#ff4fd8', edge: '#ffffff', glow: '#ffffff', anim: 'rainbow' },
];

export const ENEMY_FINISHES: Finish[] = [
  { id: 'mud', name: 'Boueux', rarity: 'common', body: '#7a5c3a', edge: '#45321d' },
  { id: 'ash', name: 'Cendré', rarity: 'common', body: '#8d8d8d', edge: '#4a4a4a' },
  { id: 'moss', name: 'Moussu', rarity: 'common', body: '#5f8f3e', edge: '#33521e' },
  { id: 'toxic', name: 'Toxique', rarity: 'rare', body: '#9be22d', edge: '#4d7a0c', glow: '#b8ff4a' },
  { id: 'frost', name: 'Gelé', rarity: 'rare', body: '#a8e6ff', edge: '#3b8db3' },
  { id: 'gilded', name: 'Doré', rarity: 'epic', body: '#e6b422', edge: '#8a6a0a', glow: '#ffd86b' },
  { id: 'blood', name: 'Sanglant', rarity: 'epic', body: '#a3122a', edge: '#4f0612', glow: '#ff3355' },
  { id: 'ghost', name: 'Spectral', rarity: 'legendary', body: '#d8e4ff', edge: '#7d8fc4', glow: '#d8e4ff', alpha: 0.6, anim: 'pulse' },
  { id: 'ember', name: 'Braise', rarity: 'legendary', body: '#ff7b2e', edge: '#7a2a05', glow: '#ffb05c', anim: 'flicker' },
  { id: 'cosmic', name: 'Cosmique', rarity: 'mythic', body: '#5b2bd9', edge: '#ffffff', glow: '#b49cff', anim: 'rainbow' },
];

export interface CrateDef {
  id: string;
  name: string;
  kind: 'hero' | 'skin';
  text: string;
  contents: string[]; // objets possibles
}

export const CRATES: CrateDef[] = [
  { id: 'heroes', name: 'Caisse de héros', kind: 'hero', text: '8 héros qui renforcent toute la partie. Un héros déjà obtenu monte d’un niveau (5 au maximum).', contents: HEROES.map((h) => `hero:${h.id}`) },
  { id: 'tower_skins', name: 'Skins de tours', kind: 'skin', text: '10 finitions pour chacune des 10 tours.', contents: TOWERS.filter((t) => !t.special).flatMap((t) => TOWER_FINISHES.map((f) => `ts:${t.id}:${f.id}`)) },
  { id: 'enemy_skins', name: 'Skins d’ennemis', kind: 'skin', text: '10 finitions pour chacun des 20 ennemis.', contents: ENEMIES.flatMap((e) => ENEMY_FINISHES.map((f) => `es:${e.id}:${f.id}`)) },
];

export interface SkinRef {
  target: 'tower' | 'enemy';
  subject: string; // id de la tour ou de l'ennemi
  slot: string;
  finish: Finish;
}

export function skinOf(id: string): SkinRef | null {
  const m = /^(ts|es):(\w+):(\w+)$/.exec(id);
  if (!m) return null;
  const finish = (m[1] === 'ts' ? TOWER_FINISHES : ENEMY_FINISHES).find((f) => f.id === m[3]);
  if (!finish) return null;
  return { target: m[1] === 'ts' ? 'tower' : 'enemy', subject: m[2], slot: `${m[1]}:${m[2]}`, finish };
}

/** Héros désigné par un identifiant du catalogue (`hero:<id>`). */
export const heroOf = (id: string) => (id.startsWith('hero:') ? HEROES.find((h) => h.id === id.slice(5)) ?? null : null);

export function itemName(id: string): string {
  const skin = skinOf(id);
  if (skin) {
    const subject = skin.target === 'tower' ? TOWERS.find((t) => t.id === skin.subject)?.name : ENEMIES.find((e) => e.id === skin.subject)?.name;
    return `${subject ?? skin.subject} ${skin.finish.name}`;
  }
  const hero = heroOf(id);
  if (hero) return hero.name;
  return TOWERS.find((t) => t.id === id)?.name ?? id;
}
