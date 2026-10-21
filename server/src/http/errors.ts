// Erreurs renvoyées aux joueurs : un statut HTTP et un message lisible, en JSON { error }.

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
  }
}

export const bad = (message: string) => new AppError(400, message);
export const forbidden = (message: string) => new AppError(403, message);
export const notFound = (message: string) => new AppError(404, message);

/**
 * Erreur levée par une fonction SQL encore utilisée (points_spend…) : ses codes P0001 (règle),
 * P0002 (introuvable) et 22023 (paramètre) portent un message pour le joueur ; le reste est interne.
 */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const code = (e as { code?: string } | null)?.code;
  const message = (e as Error | null)?.message ?? 'erreur';
  if (code === 'P0001' || code === '22023') return bad(message);
  if (code === 'P0002') return notFound(message);
  return new AppError(500, 'erreur du serveur');
}
