// Copie de src/games/four/engine/ai4.ts (scripts/td-sync.mjs) : ne pas modifier ici.
// Ordinateurs des jeux à 4 : des heuristiques d'un coup (une recherche en profondeur à 4 joueurs
// serait trop lente), assez solides pour une partie détendue. Utilisés en solo et par le serveur
// pour les places vides d'une partie en ligne.

import * as chess from './chess4.ts';
import * as quoridor from './quoridor4.ts';
import { SEATS, type Ai4 } from './types.ts';

const VALUE = [0, 1, 3, 3, 5, 9, 0];
const pick = <T>(items: { item: T; score: number }[]): T => {
  let best = items[0];
  for (const it of items) if (it.score > best.score) best = it;
  return best.item;
};

export const chessAi: Ai4 = (b, seat) => {
  const list = chess.moves(b, seat);
  return pick(
    list.map((mv) => {
      const { from, to } = chess.parse(mv)!;
      const moving = b[from];
      const target = b[to];
      const after = chess.apply(b, seat, mv);
      let score = Math.random() * 1.5;
      if (target) {
        const o = chess.ownerOf(target);
        score += chess.typeOf(target) === chess.KING && o !== chess.DEAD ? 1000 : (o === chess.DEAD ? 1 : VALUE[chess.typeOf(target)] * 10);
      }
      if (chess.typeOf(after[to]) !== chess.typeOf(moving)) score += 80; // promotion
      // Pièce laissée en prise sur sa case d'arrivée.
      if (chess.attacked(after, to, seat)) score -= VALUE[chess.typeOf(after[to])] * 9;
      // Pièce qui était en danger et qui s'en va.
      if (chess.attacked(b, from, seat) && !chess.attacked(after, to, seat)) score += VALUE[chess.typeOf(moving)] * 6;
      // Donner échec à quelqu'un.
      for (const s of SEATS) if (s !== seat && chess.alive(after, s) && chess.inCheck(after, s)) score += 3;
      // Occuper le centre, un peu.
      const r = Math.floor(to / chess.N);
      const c = to % chess.N;
      score += (7 - Math.abs(6.5 - r) - Math.abs(6.5 - c)) * 0.15;
      return { item: mv, score };
    }),
  );
};

export const quoridorAi: Ai4 = (b, seat) => {
  const list = quoridor.moves(b, seat);
  if (list[0] === 'pass') return 'pass';
  const mine = quoridor.distance(b, seat);
  const rivals = SEATS.filter((s) => s !== seat && b[s] >= 0);
  // Adversaire le plus près du but.
  let leader = rivals[0];
  for (const s of rivals) if (quoridor.distance(b, s) < quoridor.distance(b, leader)) leader = s;
  const leaderDist = quoridor.distance(b, leader);
  // Un mur, si un adversaire va gagner avant nous et qu'un mur le ralentit plus que nous.
  if (b[4 + seat] > 0 && leaderDist <= Math.min(mine, 4)) {
    let best: { mv: string; gain: number } | null = null;
    for (const mv of list) {
      if (mv[0] === 'm') continue;
      const after = quoridor.apply(b, seat, mv);
      const gain = quoridor.distance(after, leader) - leaderDist - (quoridor.distance(after, seat) - mine) + Math.random() * 0.3;
      if (gain >= 0.9 && (!best || gain > best.gain)) best = { mv, gain };
    }
    if (best) return best.mv;
  }
  // Sinon, avancer sur le plus court chemin.
  return pick(
    list
      .filter((mv) => mv[0] === 'm')
      .map((mv) => ({ item: mv, score: -quoridor.distance(quoridor.apply(b, seat, mv), seat) + Math.random() * 0.2 })),
  ) ?? list[0];
};

export const aiFor = (game: 'chess4' | 'quoridor4'): Ai4 => (game === 'chess4' ? chessAi : quoridorAi);
