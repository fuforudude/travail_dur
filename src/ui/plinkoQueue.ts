import type { PlinkoRisk } from '../net/points';

/** Limite du Plinko, miroir du serveur (0054) : 10 billes d'un coup, puis 10 par seconde. */
export const BURST = 10;
export const PER_SECOND = 10;

/**
 * Écart minimal entre deux appels au serveur (≈ 6,7 appels/s). Le serveur refuse au-delà de 8 appels par seconde :
 * sans cet écart, un réseau rapide (10-40 ms) enchaîne les appels et fait perdre des billes en silence.
 */
export const MIN_GAP_MS = 150;

/**
 * Attente maximale d'une bille avant son envoi. Au-delà, elle est abandonnée et sa mise rendue, sans message :
 * un clic part ou ne part pas, rien n'est jamais gardé pour plus tard. C'est ce qui garantit qu'après le dernier
 * clic plus aucune bille ne parte, en dehors de l'appel déjà en vol et de l'envoi en préparation.
 */
export const MAX_WAIT_MS = 400;

/**
 * Retard maximal de la **dernière** bille d'un envoi sur la réponse du serveur (voir `dropDelays`). Tout l'envoi tient
 * dans cette fenêtre : l'écart entre deux billes est resserré s'il le faut. Sans ce plafond, le site égrènerait les
 * billes exactement aussi vite que le joueur peut cliquer, le retard pris sur la première rafale ne se rattraperait
 * jamais et des billes continueraient de tomber plus d'une seconde après le dernier clic.
 */
export const MAX_LEAD_MS = 400;

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
      if (tokens < 1 - 1e-9) return false; // 10 × (1/10 s) peut donner 0,999… jeton en virgule flottante
      tokens = Math.max(0, tokens - 1);
      return true;
    },
  };
}

/**
 * Instants de chute de `count` billes qui viennent d'arriver, à `gapMs` d'écart, en repartant de `from` (le
 * « prochain lâcher possible », commun à tous les envois pour que deux envois à la suite restent espacés).
 * Tout l'envoi tient dans `maxLeadMs` après `now` : l'écart est resserré pour les gros envois (10 billes s'égrènent
 * sur 400 ms, soit 40 ms entre billes) et le départ est avancé d'autant, pour que la **dernière** bille parte au plus
 * `maxLeadMs` après `now`. Un petit envoi garde l'écart nominal. Retourne l'attente de chaque bille et le `from` suivant.
 */
export function dropDelays(from: number, now: number, count: number, gapMs: number, maxLeadMs = MAX_LEAD_MS) {
  const gap = count > 1 ? Math.min(gapMs, maxLeadMs / count) : gapMs;
  const span = Math.max(0, count - 1) * gap; // durée de l'égrenage, à réserver dans la fenêtre
  let at = Math.min(Math.max(from, now), now + maxLeadMs - span);
  const delays: number[] = [];
  for (let i = 0; i < count; i++) {
    delays.push(at - now);
    at += gap;
  }
  return { delays, next: at };
}

/**
 * Temps sans qu'aucune bille ne tombe au bout duquel le mode auto s'arrête. Le chronomètre repart à zéro dès qu'une
 * bille tombe : une connexion lente mais qui avance n'est jamais interrompue. Sans cette borne, un serveur qui refuse
 * tout (« doucement » à chaque appel) fait tourner l'auto sans fin — chaque clic remboursé recrée la dette qu'il vient
 * de solder, le solde ne baisse jamais et aucune bille ne tombe.
 *
 * Borne en **temps** et pas en clics : un nombre de clics mesure une durée avec une règle qui dépend de la vitesse de
 * l'auto, et 25 clics (2,4 s en rapide) ne couvraient même pas un aller-retour lent — l'auto s'arrêtait avant la
 * première bille à 3 s de latence. 10 s couvrent largement l'aller-retour le plus lent, tout en bornant aussi un
 * serveur **muet**, dont aucune réponse n'arrive jamais.
 */
export const MAX_MS_SANS_BILLE = 10_000;

/**
 * Temps maximal passé, au dernier tour d'une série, à attendre que tout soit retombé. `rpc` n'a pas de délai maximal
 * et l'animation d'une bille est gelée dans un onglet en arrière-plan : sans cette borne, l'attente peut ne jamais
 * se terminer.
 */
export const DRAIN_MAX_MS = 5000;

/** Ce qu'un clic a fait : bille mise en file, plus de jeton, pas assez de points, ou Plinko indisponible. */
export type Click = 'ok' | 'token' | 'poor' | 'off';

/** Compteurs d'une série du mode auto, remis à zéro à chaque démarrage de série. */
export interface AutoState {
  /**
   * Billes dues : une bille payée au clic mais jamais tombée (abandonnée faute d'avoir pu partir à temps, ou refusée
   * par le serveur) n'a pas joué le tour qu'elle a consommé. Tant qu'il reste des dettes, un clic réussi en solde une
   * au lieu de consommer un tour, pour qu'« Auto ×N » joue bien N billes même sur un réseau lent.
   */
  owed: number;
  /** Instant du dernier progrès (garde `MAX_MS_SANS_BILLE`) ; −1 tant que la série n'a pas cliqué. */
  since: number;
  /** Nombre de billes tombées vu au dernier progrès : c'est lui qui dit si la série avance. */
  landed: number;
}

export const newAutoState = (): AutoState => ({ owed: 0, since: -1, landed: 0 });

/** Ce dont un tour d'auto a besoin de la page : tout est injecté, pour que la boucle soit testable telle quelle. */
export interface AutoStepDeps {
  state: AutoState;
  /** Un clic : une bille en file à la mise courante. */
  click: () => Click;
  /** Attente, qui rend la main au navigateur (ou à l'horloge simulée des tests). */
  wait: (ms: number) => Promise<void>;
  now: () => number;
  /** Des billes sont en file, en vol ou en l'air. */
  busy: () => boolean;
  /** L'auto tourne toujours (le joueur n'a pas appuyé sur « Arrêter »). */
  running: () => boolean;
  /** La page est toujours là. */
  alive: () => boolean;
  /** Dernier tour de la série. */
  last: () => boolean;
  /** Nombre total de billes tombées depuis l'ouverture de la page (seule sa progression compte). */
  landed: () => number;
  /** Attente entre deux clics : 1/10 s en rapide, 1 s en normale. */
  gapMs: () => number;
  /** Plus assez de points : l'auto s'arrête. */
  onPoor: () => void;
  /** Rien n'avance plus depuis `MAX_MS_SANS_BILLE` : l'auto s'arrête. */
  onStuck: () => void;
}

/**
 * Un tour du mode auto : clique jusqu'à ce qu'une bille ait vraiment joué le tour, et dit par son retour si la série
 * continue (`false` = arrêter l'auto). Fonction sans DOM ni horloge réelle : la page et les tests jouent la **même**
 * boucle.
 */
export async function autoStep(d: AutoStepDeps): Promise<boolean> {
  const s = d.state;
  for (;;) {
    const r = d.click();
    if (r === 'off') return false;
    if (r === 'poor' && !d.busy()) {
      // Le solde manque et plus rien n'est en file, en vol ni en l'air : aucun gain ne viendra le renflouer.
      // Les dettes restantes sont oubliées : l'auto s'arrête, il ne tourne pas en boucle pour les solder.
      d.onPoor();
      return false;
    }
    if (r === 'ok') {
      // Progrès = une bille de plus tombée. Le chronomètre repart de zéro à chaque progrès (et au premier clic de la
      // série) ; au bout de MAX_MS_SANS_BILLE sans aucune bille, la série s'arrête : le serveur ne suit plus du tout.
      const t = d.now();
      const landed = d.landed();
      if (landed > s.landed || s.since < 0) {
        s.landed = landed;
        s.since = t;
      } else if (t - s.since >= MAX_MS_SANS_BILLE) {
        d.onStuck();
        return false;
      }
      await d.wait(d.gapMs());
      // Dernier tour de la série : on laisse tout retomber avant de conclure, sinon une bille abandonnée au tout
      // dernier moment n'aurait plus de tour pour être rejouée et « ×100 » s'arrêterait à 99. Attente bornée : la
      // promesse d'un appel ou d'une animation peut ne jamais se résoudre.
      if (!s.owed && d.last()) {
        const until = d.now() + DRAIN_MAX_MS;
        while (d.busy() && d.running() && d.alive() && d.now() < until) await d.wait(20);
      }
      if (!s.owed) return d.alive(); // le tour est joué
      s.owed--; // ce clic remplace une bille qui n'est jamais tombée : le tour n'est pas consommé
    } else {
      await d.wait(20); // plus de jeton, ou gains encore en route : on attend au lieu d'arrêter l'auto
    }
    if (!d.alive() || !d.running()) return false;
  }
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
  /** Billes refusées par le serveur : elles sont remboursées, jamais relancées. */
  refused?: number;
}

export interface QueueOptions {
  /** Appelé après chaque réponse et après chaque abandon, une fois l'envoi suivant éventuel parti. */
  settled?: () => void;
  /**
   * Mises à rendre, toujours en silence : qu'une bille soit abandonnée faute d'avoir pu partir à temps ou refusée
   * par le serveur, le joueur voit la même chose — un clic qui n'a rien coûté.
   */
  refund?: (stake: number, balls: number) => void;
  max?: number;
  gapMs?: number;
  maxWaitMs?: number;
  /** Horloge et minuteur, remplacés par les tests. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

/** Groupe en file : une bille par instant de clic, pour abandonner les plus vieilles une à une. */
interface Pending {
  bet: number;
  rows: number;
  risk: PlinkoRisk;
  ts: number[];
}

/**
 * File des billes : un seul appel en vol, et au moins `gapMs` entre deux envois. La première bille d'une série part
 * tout de suite ; celles qui arrivent pendant l'appel ou pendant l'attente partent ensemble (au plus `max` par
 * appel). Un changement de mise ouvre un nouveau groupe, envoyé séparément. Rien n'est jamais gardé : une bille qui
 * n'a pas pu partir en `maxWaitMs` est abandonnée et remboursée, et une bille refusée par le serveur est remboursée
 * aussi — elle n'est pas relancée. `send` traite lui-même ses erreurs.
 */
export function batchQueue(send: (g: PlinkoGroup) => Promise<SendResult | void>, opts: QueueOptions = {}) {
  const {
    settled = () => {},
    refund = () => {},
    max = BURST,
    gapMs = MIN_GAP_MS,
    maxWaitMs = MAX_WAIT_MS,
    now = () => performance.now(),
    setTimer = (fn, ms) => window.setTimeout(fn, ms),
    clearTimer = (id) => window.clearTimeout(id),
  } = opts;

  const groups: Pending[] = [];
  let flying = false;
  let timer = 0;
  let lastSent = -Infinity;
  let gen = 0; // incrémenté par clear() : une réponse d'avant ne rembourse plus rien

  const stop = () => {
    if (timer) clearTimer(timer);
    timer = 0;
  };

  /**
   * Abandonne les billes qui attendent depuis plus de `maxWaitMs` et rend leur mise, sans message. Dit par son
   * retour s'il y a eu un remboursement : `pump` doit alors appeler `settled()`, sans quoi le solde rendu ne serait
   * pas réaffiché (ça ne se voyait pas tant qu'un appel était toujours en vol au même moment).
   */
  const expire = (): boolean => {
    const limit = now() - maxWaitMs;
    let any = false;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      let n = 0;
      while (n < g.ts.length && g.ts[n] <= limit) n++;
      if (!n) continue;
      g.ts.splice(0, n);
      if (!g.ts.length) groups.splice(i, 1);
      any = true;
      refund(n * g.bet, n);
    }
    return any;
  };

  const fire = () => {
    const head = groups[0];
    const n = Math.min(max, head.ts.length);
    head.ts.splice(0, n);
    if (!head.ts.length) groups.shift();
    const g: PlinkoGroup = { bet: head.bet, rows: head.rows, risk: head.risk, n };
    const mine = gen;
    flying = true;
    lastSent = now();
    void Promise.resolve()
      .then(() => send(g))
      .catch(() => undefined) // send gère ses erreurs ; la file ne doit jamais rester bloquée
      .then((res) => {
        flying = false;
        const refused = Math.min(n, Math.max(0, Math.floor((res && res.refused) || 0)));
        if (mine === gen && refused) refund(refused * g.bet, refused);
        pump();
        settled();
      });
  };

  const schedule = () => {
    if (!groups.length) return;
    const t = now();
    const gap = flying ? Infinity : Math.max(0, lastSent + gapMs - t);
    if (gap === 0) {
      fire();
      return;
    }
    // Rien ne peut partir maintenant : on se réveille au plus tôt entre le prochain envoi possible et l'instant
    // où la plus vieille bille en attente est abandonnée.
    const deadline = Math.max(0, groups[0].ts[0] + maxWaitMs - t);
    timer = setTimer(() => {
      timer = 0;
      pump();
    }, Math.min(gap, deadline));
  };

  function pump() {
    stop();
    const gone = expire();
    schedule();
    if (gone) settled(); // un abandon rend la mise : il faut le rendre visible, personne d'autre ne le fera
  }

  return {
    push(bet: number, rows: number, risk: PlinkoRisk) {
      const last = groups[groups.length - 1];
      if (last && last.bet === bet && last.rows === rows && last.risk === risk) last.ts.push(now());
      else groups.push({ bet, rows, risk, ts: [now()] });
      pump();
    },
    /** Billes pas encore envoyées. */
    waiting: () => groups.reduce((t, g) => t + g.ts.length, 0),
    inFlight: () => flying,
    /** Vide la file sans l'envoyer, minuteur compris ; retourne le total des mises à rendre. */
    clear(): number {
      const stake = groups.reduce((t, g) => t + g.ts.length * g.bet, 0);
      groups.length = 0;
      gen++;
      stop();
      return stake;
    },
  };
}
