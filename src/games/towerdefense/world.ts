// Carte du monde de la campagne (façon Kingdom Rush) : des pages (une par acte), chacune avec un
// chemin sinueux qui relie des ronds numérotés. Seuls les niveaux débloqués sont montrés.

import { BONUS, CHAPTER2_FIRST, CHAPTER2_LAST, LEVEL_COUNT } from './engine/data';
import { ACTS, ACTS2, BONUS_ACT } from './story';

export interface WorldPage {
  id: string;
  title: string;
  chapter: string;
  levels: number[]; // tous les niveaux de la page, dans l'ordre (débloqués ou non)
  tone: number; // teinte du fond (1 à 5)
}

/** Les pages, dans l'ordre : chapitre 1 (3 actes), défis bonus, chapitre 2 (4 actes). */
export function worldPages(): WorldPage[] {
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const pages: WorldPage[] = ACTS.map((act, k) => ({
    id: `c1-${k}`,
    title: act.name,
    chapter: 'Chapitre 1 · Le Royaume des Cramptés',
    levels: range(act.from, (ACTS[k + 1]?.from ?? LEVEL_COUNT + 1) - 1),
    tone: [3, 4, 5][k] ?? 1,
  }));
  pages.push({ id: 'bonus', title: BONUS_ACT.name, chapter: 'Défis bonus', levels: BONUS.map((_, k) => LEVEL_COUNT + 1 + k), tone: 2 });
  ACTS2.forEach((act, k) =>
    pages.push({
      id: `c2-${k}`,
      title: act.name,
      chapter: 'Chapitre 2 · La chasse à la sorcière',
      levels: range(act.from, (ACTS2[k + 1]?.from ?? CHAPTER2_LAST + 1) - 1),
      tone: [1, 2, 4, 5][k] ?? 1,
    }),
  );
  return pages;
}

/**
 * Position (en % de la carte) du i-ème rond d'une page de n niveaux : un chemin en serpentin, sur
 * deux ou trois rangées selon le nombre de niveaux, avec une petite variation par page.
 */
export function nodePosition(i: number, n: number, page: number): [number, number] {
  const rows = n > 9 ? 3 : n > 5 ? 2 : 1;
  const perRow = Math.ceil(n / rows);
  const row = Math.floor(i / perRow);
  const col = i % perRow;
  const left = row % 2 === 0; // une rangée sur deux se lit de droite à gauche
  const t = perRow > 1 ? col / (perRow - 1) : 0.5;
  const x = 10 + (left ? t : 1 - t) * 80;
  const baseY = rows === 1 ? 55 : 28 + (row * 54) / (rows - 1); // le haut est laissé au titre de l'acte
  const wave = Math.sin((col + page) * 1.7) * (rows === 1 ? 18 : 6);
  return [x, baseY + wave];
}

/** Chemin SVG (courbe lissée) qui passe par les points donnés (en %). */
export function pathThrough(points: [number, number][]): string {
  if (!points.length) return '';
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1];
    const [x1, y1] = points[k];
    const mx = (x0 + x1) / 2;
    d += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  return d;
}

export const isChapter2Level = (L: number) => L >= CHAPTER2_FIRST && L <= CHAPTER2_LAST;
