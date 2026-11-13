// Montants courts, purs (sans Supabase) pour rester testables seuls ; points.ts les ré-exporte.

/** Quotient arrondi à 2 décimales (évite 1,005 → 1) : 1 005 000 000 000 / 1e12 → 1,01. */
const compact = (n: number, unit: number) => (Math.round((n / unit) * 100 + 1e-9) / 100).toLocaleString('fr-FR');

/** Montant court pour les jetons : 2,5 k, 10 M, 95 Md, 37,5 T… (n ≥ 0 ; en dessous de 10 000, le chiffre exact). */
export const shortPoints = (n: number) =>
  n >= 1e12 ? `${compact(n, 1e12)} T`
  : n >= 1e9 ? `${compact(n, 1e9)} Md`
  : n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR')} M`
  : n >= 1e4 ? `${(n / 1e3).toLocaleString('fr-FR')} k`
  : n.toLocaleString('fr-FR');

/** Bilan signé en montant court : « +95 Md », « −1,01 T » (vrai signe moins), « 0 ». */
export const signedShortPoints = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + shortPoints(Math.abs(n));
