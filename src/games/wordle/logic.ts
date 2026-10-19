/** Majuscules sans accents : « é » compte comme « E ». */
export function normalizeLetter(key: string): string | null {
  if (key.length !== 1) return null;
  const c = key.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return /^[A-Z]$/.test(c) ? c : null;
}

/**
 * Couleurs d'une proposition : '2' bien placée, '1' présente ailleurs, '0' absente.
 * Règles officielles pour les lettres en double. Identique à public.wordle_pattern.
 */
export function pattern(guess: string, answer: string): string {
  const res = [0, 0, 0, 0, 0];
  const rest: string[] = [];
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) res[i] = 2;
    else rest.push(answer[i]);
  }
  for (let i = 0; i < 5; i++) {
    if (res[i]) continue;
    const j = rest.indexOf(guess[i]);
    if (j >= 0) {
      res[i] = 1;
      rest[j] = '-';
    }
  }
  return res.join('');
}

/** Numéro du mot du jour, pour l'affichage (« Mot n°42 »). */
export const dayNumber = (day: string) => Math.floor((Date.parse(day) - Date.parse('2026-01-01')) / 86400000) + 1;
