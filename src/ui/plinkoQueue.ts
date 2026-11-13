import type { PlinkoRisk } from '../net/points';

/** Limite du Plinko, miroir du serveur (0053_plinko_rafale.sql) : 15 billes d'un coup, puis 15 par seconde. */
export const BURST = 15;
export const PER_SECOND = 15;

/**
 * Seau à jetons : `capacity` jetons au départ, `perSecond` jetons regagnés par seconde, un jeton par bille.
 * Côté site, il sert seulement à ignorer les clics que le serveur refuserait de toute façon.
 */
export function tokenBucket(capacity = BURST, perSecond = PER_SECOND, now: () => number = () => performance.now()) {
  let tokens = capacity;
  let at = now();
  return {
    take(): boolean {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - at) * perSecond) / 1000);
      at = t;
      if (tokens < 1 - 1e-9) return false; // 15 × (1/15 s) peut donner 0,999… jeton en virgule flottante
      tokens = Math.max(0, tokens - 1);
      return true;
    },
  };
}

/** Billes en attente d'envoi : une seule mise, un seul nombre de rangées, un seul risque par groupe. */
export interface PlinkoGroup {
  bet: number;
  rows: number;
  risk: PlinkoRisk;
  n: number;
}

/**
 * File des billes : un seul appel en vol. La première bille part tout de suite ; celles qui arrivent pendant
 * l'appel s'accumulent et partent ensemble à la réponse (au plus `max` par appel). Un changement de mise ouvre
 * un nouveau groupe, envoyé séparément. `send` traite lui-même la réponse et ne doit pas échouer ;
 * `settled` est appelé après chaque réponse, une fois l'envoi suivant éventuel parti.
 */
export function batchQueue(send: (g: PlinkoGroup) => Promise<void>, settled: () => void = () => {}, max = BURST) {
  const groups: PlinkoGroup[] = [];
  let flying = false;

  const pump = () => {
    if (flying || !groups.length) return;
    const head = groups[0];
    const n = Math.min(max, head.n);
    head.n -= n;
    if (!head.n) groups.shift();
    flying = true;
    void send({ ...head, n })
      .catch(() => {}) // send gère ses erreurs ; la file ne doit jamais rester bloquée
      .then(() => {
        flying = false;
        pump();
        settled();
      });
  };

  return {
    push(bet: number, rows: number, risk: PlinkoRisk) {
      const last = groups[groups.length - 1];
      if (last && last.bet === bet && last.rows === rows && last.risk === risk) last.n++;
      else groups.push({ bet, rows, risk, n: 1 });
      pump();
    },
    /** Billes pas encore envoyées. */
    waiting: () => groups.reduce((t, g) => t + g.n, 0),
    inFlight: () => flying,
    /** Vide la file sans l'envoyer ; retourne le total des mises à rendre. */
    clear(): number {
      const stake = groups.reduce((t, g) => t + g.n * g.bet, 0);
      groups.length = 0;
      return stake;
    },
  };
}
