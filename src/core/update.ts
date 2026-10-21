// Mises à jour du site : un onglet resté ouvert garde son ancien code, même après une nouvelle
// version (c'est ainsi que des parties de tower defense n'ont pas été enregistrées). On compare donc
// régulièrement le numéro embarqué (__BUILD__) à celui de version.json ; s'il a changé, le site se
// recharge au prochain changement de page, et un petit message prévient.

const EVERY = 10 * 60_000;
let stale = false;
const listeners = new Set<() => void>();

/** Une nouvelle version est en ligne : la page doit être rechargée. */
export const isStale = () => stale;

/** Prévenu (une fois) quand une nouvelle version est détectée. */
export function onStale(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function check(): Promise<void> {
  if (stale || __BUILD__ === 'dev') return;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { build } = (await r.json()) as { build?: string };
    if (build && build !== __BUILD__) {
      stale = true;
      listeners.forEach((cb) => cb());
    }
  } catch {
    // hors ligne : on réessaiera
  }
}

export function startUpdateChecks(): void {
  void check();
  window.setInterval(() => void check(), EVERY);
  document.addEventListener('visibilitychange', () => !document.hidden && void check());
}
