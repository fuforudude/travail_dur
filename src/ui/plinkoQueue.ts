import type { PlinkoRisk } from '../net/points';

/** Limite du Plinko, miroir du serveur (0053_plinko_rafale.sql) : 15 billes d'un coup, puis 15 par seconde. */
export const BURST = 15;
export const PER_SECOND = 15;

/**
 * Écart minimal entre deux appels au serveur (≈ 6,7 appels/s). Le serveur refuse au-delà de 8 appels par seconde :
 * sans cet écart, un réseau rapide (10-40 ms) enchaîne les appels et fait perdre des billes en silence.
 */
export const MIN_GAP_MS = 150;

/** Réessais d'un même groupe refusé (« trop d'appels » ou billes refusées) avant de rendre la mise et d'abandonner. */
export const MAX_RETRIES = 3;

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

/** Ce que `send` apprend à la file sur le sort du groupe qu'elle vient d'envoyer. */
export interface SendResult {
  /** Le serveur a refusé l'appel entier (« doucement : trop d'appels ») : le groupe repart un peu plus tard. */
  retry?: boolean;
  /** Billes refusées par le serveur (décalage des deux seaux) : elles repartent dans l'envoi suivant. */
  requeue?: number;
}

export interface QueueOptions {
  /** Appelé après chaque réponse, une fois l'envoi suivant éventuel parti. */
  settled?: () => void;
  /** Mises à rendre quand un groupe est abandonné après `MAX_RETRIES` réessais. */
  refund?: (stake: number, balls: number) => void;
  max?: number;
  gapMs?: number;
  /** Horloge et minuteur, remplacés par les tests. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

/** Groupe en file, avec le nombre de réessais déjà consommés. */
interface Pending extends PlinkoGroup {
  tries: number;
}

/**
 * File des billes : un seul appel en vol, et au moins `gapMs` entre deux envois. La première bille d'une série part
 * tout de suite ; celles qui arrivent pendant l'appel ou pendant l'attente s'accumulent et partent ensemble (au plus
 * `max` par appel). Un changement de mise ouvre un nouveau groupe, envoyé séparément. `send` traite lui-même ses
 * erreurs et dit à la file, par son résultat, s'il faut renvoyer le groupe ou remettre des billes en file.
 */
export function batchQueue(send: (g: PlinkoGroup) => Promise<SendResult | void>, opts: QueueOptions = {}) {
  const {
    settled = () => {},
    refund = () => {},
    max = BURST,
    gapMs = MIN_GAP_MS,
    now = () => performance.now(),
    setTimer = (fn, ms) => window.setTimeout(fn, ms),
    clearTimer = (id) => window.clearTimeout(id),
  } = opts;

  const groups: Pending[] = [];
  let flying = false;
  let timer = 0;
  let lastSent = -Infinity;
  let gen = 0; // incrémenté par clear() : une réponse d'avant ne remet plus rien en file

  /**
   * Remet un groupe en tête de file, ou rend sa mise s'il a épuisé ses réessais. Le compteur garde seulement contre
   * une boucle sans fin : un envoi dont une partie est passée a progressé, il repart avec un compteur neuf.
   */
  const again = (g: Pending, progress: boolean) => {
    const tries = progress ? 0 : g.tries + 1;
    if (tries > MAX_RETRIES) refund(g.n * g.bet, g.n);
    else groups.unshift({ ...g, tries });
  };

  const pump = () => {
    if (flying || timer || !groups.length) return;
    const left = lastSent + gapMs - now();
    if (left > 0) {
      timer = setTimer(() => {
        timer = 0;
        pump();
      }, left);
      return;
    }
    const head = groups[0];
    const n = Math.min(max, head.n);
    head.n -= n;
    if (!head.n) groups.shift();
    const sent: Pending = { bet: head.bet, rows: head.rows, risk: head.risk, n, tries: head.tries };
    const mine = gen;
    flying = true;
    lastSent = now();
    void Promise.resolve()
      .then(() => send({ bet: sent.bet, rows: sent.rows, risk: sent.risk, n: sent.n }))
      .catch(() => undefined) // send gère ses erreurs ; la file ne doit jamais rester bloquée
      .then((res) => {
        flying = false;
        if (mine === gen) {
          const r = res || {};
          if (r.retry) again(sent, false);
          else {
            const back = Math.min(sent.n, Math.max(0, Math.floor(r.requeue || 0)));
            if (back) again({ ...sent, n: back }, back < sent.n);
          }
        }
        pump();
        settled();
      });
  };

  return {
    push(bet: number, rows: number, risk: PlinkoRisk) {
      const last = groups[groups.length - 1];
      if (last && last.bet === bet && last.rows === rows && last.risk === risk && !last.tries) last.n++;
      else groups.push({ bet, rows, risk, n: 1, tries: 0 });
      pump();
    },
    /** Billes pas encore envoyées. */
    waiting: () => groups.reduce((t, g) => t + g.n, 0),
    inFlight: () => flying,
    /** Vide la file sans l'envoyer, minuteur compris ; retourne le total des mises à rendre. */
    clear(): number {
      const stake = groups.reduce((t, g) => t + g.n * g.bet, 0);
      groups.length = 0;
      gen++;
      if (timer) clearTimer(timer);
      timer = 0;
      return stake;
    },
  };
}
