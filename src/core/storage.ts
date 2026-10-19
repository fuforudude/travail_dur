// Accès localStorage tolérant : navigation privée, stockage bloqué ou plein.
const PREFIX = 'td:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Pas de stockage disponible : on continue sans persister.
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // idem
  }
}

export function getBest(gameId: string): number {
  return load<number>(`best:${gameId}`, 0);
}

export function setBest(gameId: string, score: number): number {
  const best = Math.max(getBest(gameId), score);
  save(`best:${gameId}`, best);
  return best;
}
