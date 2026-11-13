// Tests des fonctions pures du Plinko en rafale (seau à jetons, file d'envoi, égrenage), lanceur intégré de Node :
//   npm run test:site
// Fichier en .mjs : Node 22.18+ enlève lui-même les types de plinkoQueue.ts, sans dépendance ni compilation.
import test from 'node:test';
import assert from 'node:assert/strict';

import { batchQueue, BURST, dropDelays, MAX_LEAD_MS, MAX_WAIT_MS, MIN_GAP_MS, PER_SECOND, tokenBucket } from './plinkoQueue.ts';

/** Horloge et minuteurs simulés : le temps n'avance que quand le test le demande. */
function makeClock() {
  let t = 0;
  let seq = 0;
  let timers = [];
  const clock = {
    now: () => t,
    setTimer(fn, ms) {
      const id = ++seq;
      timers.push({ id, at: t + Math.max(0, ms), fn });
      return id;
    },
    clearTimer(id) {
      timers = timers.filter((x) => x.id !== id);
    },
    count: () => timers.length,
    /** Laisse les promesses déjà résolues enchaîner leurs `then`. */
    async flush() {
      for (let i = 0; i < 200; i++) await Promise.resolve();
    },
    /** Avance de `ms`, en déclenchant les minuteurs dans l'ordre. */
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await clock.flush();
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = Math.max(t, due.at);
        timers = timers.filter((x) => x !== due);
        due.fn();
      }
      t = end;
      await clock.flush();
    },
  };
  return clock;
}

/** Générateur déterministe (xorshift32) : un échec de simulation se rejoue à l'identique. */
function seeded(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

const sleep = (clock, ms) => new Promise((ok) => clock.setTimer(ok, ms));

/** File branchée sur l'horloge simulée, avec la trace de tous les envois. */
function makeQueue(clock, send, opts = {}) {
  const sends = [];
  let flying = 0;
  const queue = batchQueue(
    async (g) => {
      flying++;
      assert.equal(flying, 1, 'jamais deux appels en vol');
      sends.push({ at: clock.now(), bet: g.bet, rows: g.rows, risk: g.risk, n: g.n });
      try {
        return await send(g);
      } finally {
        flying--;
      }
    },
    { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, ...opts },
  );
  return { queue, sends };
}

const total = (sends) => sends.reduce((t, s) => t + s.n, 0);

// ---------------------------------------------------------------- seau à jetons

test('seau : 10 billes d’un coup, puis refus', () => {
  let t = 0;
  const b = tokenBucket(BURST, PER_SECOND, () => t);
  for (let i = 0; i < BURST; i++) assert.equal(b.take(), true, `bille ${i + 1}`);
  assert.equal(b.take(), false, '11e bille refusée');
});

test('seau : recharge de 10 jetons par seconde', () => {
  let t = 0;
  const b = tokenBucket(BURST, PER_SECOND, () => t);
  for (let i = 0; i < BURST; i++) b.take();
  t += 1000 / PER_SECOND;
  assert.equal(b.take(), true, 'un jeton regagné au bout de 1/10 s');
  assert.equal(b.take(), false, 'pas deux');
  t += 1000;
  for (let i = 0; i < BURST; i++) assert.equal(b.take(), true, 'seau plein au bout d’une seconde');
  assert.equal(b.take(), false, 'jamais plus que la capacité');
});

test('seau : 10 billes/s pendant 3 minutes, aucun blocage par arrondi', () => {
  let t = 0;
  const b = tokenBucket(BURST, PER_SECOND, () => t);
  for (let i = 0; i < BURST; i++) b.take(); // rafale de départ
  let ok = 0;
  for (let i = 0; i < PER_SECOND * 180; i++) {
    t += 1000 / PER_SECOND;
    if (b.take()) ok++;
  }
  assert.equal(ok, PER_SECOND * 180, 'le 0,9999999 de la virgule flottante ne doit refuser aucune bille');
});

// ---------------------------------------------------------------- égrenage des billes reçues

test('égrenage : les billes d’un envoi tombent à GAP_MS d’écart, en repartant du prochain lâcher possible', () => {
  const gap = 1000 / PER_SECOND;
  const a = dropDelays(0, 0, 3, gap);
  assert.deepEqual(a.delays, [0, gap, 2 * gap]);
  assert.equal(a.next, 3 * gap);
  // Un envoi qui arrive pendant que le précédent s'égrène reprend la suite, sans chevauchement.
  const b = dropDelays(a.next, 150, 2, gap);
  assert.deepEqual(b.delays, [3 * gap - 150, 4 * gap - 150]);
});

test('égrenage : tout l’envoi tient dans le plafond, dernière bille comprise', () => {
  const gap = 1000 / PER_SECOND;
  // Sans plafond, une file d'attente d'égrenage de 2 s ferait tomber des billes 2 s après le dernier clic.
  const r = dropDelays(5000, 3000, 2, gap);
  assert.equal(r.delays[1], MAX_LEAD_MS, 'c’est la dernière bille que le plafond borne, pas la première');
  assert.equal(r.delays[0], MAX_LEAD_MS - gap, 'un petit envoi garde l’écart nominal');
});

test('égrenage : l’écart est resserré pour un gros envoi, jamais au-delà du plafond', () => {
  const gap = 1000 / PER_SECOND;
  for (const count of [1, 2, 5, BURST]) {
    const r = dropDelays(10000, 0, count, gap); // « prochain lâcher » très loin : le plafond s'applique
    assert.equal(r.delays[count - 1], MAX_LEAD_MS, `${count} billes : la dernière part au plafond`);
    for (let i = 1; i < count; i++) {
      assert.ok(r.delays[i] - r.delays[i - 1] <= gap + 1e-9, `${count} billes : écart resserré, jamais élargi`);
    }
  }
  // 10 billes s'égrènent sur 400 ms, soit 40 ms entre billes.
  const dix = dropDelays(10000, 0, BURST, gap);
  assert.equal(Math.round(dix.delays[1] - dix.delays[0]), MAX_LEAD_MS / BURST);
});

// ---------------------------------------------------------------- file d'envoi

test('file : le premier envoi part tout de suite, les suivants au plus tôt 150 ms après', async () => {
  const clock = makeClock();
  const { queue, sends } = makeQueue(clock, () => sleep(clock, 10));
  for (let i = 0; i < 40; i++) {
    queue.push(10, 12, 'medium');
    await clock.advance(1000 / PER_SECOND);
  }
  await clock.advance(2000);
  assert.equal(sends[0].at, 0, 'le premier clic part sans attendre');
  for (let i = 1; i < sends.length; i++) {
    assert.ok(sends[i].at - sends[i - 1].at >= MIN_GAP_MS, `envoi ${i} à ${sends[i].at - sends[i - 1].at} ms du précédent`);
  }
  assert.equal(total(sends), 40, 'toutes les billes envoyées');
  assert.equal(queue.waiting(), 0);
});

test('file : regroupement au plus 10 billes, une seule mise par envoi', async () => {
  const clock = makeClock();
  // Appel long : les 40 clics arrivent d'un coup, ils ne sont pas abandonnés avant le premier envoi.
  const { queue, sends } = makeQueue(clock, () => sleep(clock, 50), { maxWaitMs: 100000 });
  for (let i = 0; i < 40; i++) queue.push(10, 12, 'medium');
  await clock.advance(10000);
  assert.deepEqual(sends.map((s) => s.n), [1, 10, 10, 10, 9]);
  for (const s of sends) assert.ok(s.n <= BURST, 'jamais plus de 10 par appel');
  assert.deepEqual([...new Set(sends.map((s) => s.bet))], [10], 'une seule mise par envoi');
});

test('file : un changement de mise ouvre un envoi séparé', async () => {
  const clock = makeClock();
  const { queue, sends } = makeQueue(clock, () => sleep(clock, 50), { maxWaitMs: 100000 });
  queue.push(10, 12, 'medium'); // part tout de suite
  for (let i = 0; i < 3; i++) queue.push(10, 12, 'medium');
  for (let i = 0; i < 2; i++) queue.push(20, 12, 'medium');
  queue.push(10, 16, 'medium'); // autre nombre de rangées : encore un autre groupe
  await clock.advance(10000);
  assert.deepEqual(
    sends.map((s) => [s.bet, s.rows, s.n]),
    [
      [10, 12, 1],
      [10, 12, 3],
      [20, 12, 2],
      [10, 16, 1],
    ],
  );
});

test('file : clear() rend le total des mises en attente et annule le minuteur', async () => {
  const clock = makeClock();
  const { queue, sends } = makeQueue(clock, () => sleep(clock, 20));
  queue.push(10, 12, 'medium'); // part tout de suite, pas remboursée
  await clock.advance(30); // réponse reçue : la file attend maintenant l'écart de 150 ms
  for (let i = 0; i < 4; i++) queue.push(10, 12, 'medium');
  for (let i = 0; i < 3; i++) queue.push(20, 12, 'medium');
  assert.equal(clock.count(), 1, 'le minuteur d’attente est armé');
  assert.equal(queue.waiting(), 7);
  assert.equal(queue.clear(), 4 * 10 + 3 * 20);
  assert.equal(clock.count(), 0, 'le minuteur est annulé tout de suite');
  assert.equal(queue.waiting(), 0);
  await clock.advance(10000);
  assert.equal(sends.length, 1, 'rien ne repart');
});

test('file : une erreur de send ne bloque pas la suite', async () => {
  const clock = makeClock();
  let calls = 0;
  const { queue, sends } = makeQueue(
    clock,
    async () => {
      await sleep(clock, 20);
      if (++calls === 1) throw new Error('réseau');
    },
    { maxWaitMs: 100000 },
  );
  for (let i = 0; i < 20; i++) queue.push(10, 12, 'medium');
  await clock.advance(5000);
  assert.equal(total(sends), 20);
  assert.equal(queue.waiting(), 0);
  assert.equal(queue.inFlight(), false);
});

test('file : les billes refusées par le serveur sont remboursées, jamais relancées', async () => {
  const clock = makeClock();
  const refunds = [];
  let calls = 0;
  const { queue, sends } = makeQueue(
    clock,
    async () => {
      await sleep(clock, 20);
      return ++calls === 2 ? { refused: 4 } : undefined; // 4 billes du 2e envoi refusées
    },
    { refund: (stake, balls) => refunds.push({ stake, balls }), maxWaitMs: 100000 },
  );
  for (let i = 0; i < 6; i++) queue.push(10, 12, 'medium');
  await clock.advance(5000);
  assert.deepEqual(sends.map((s) => s.n), [1, 5], 'les 4 billes refusées ne repartent pas');
  assert.deepEqual(refunds, [{ stake: 40, balls: 4 }]);
  assert.equal(queue.waiting(), 0);
});

test('file : une bille qui n’a pas pu partir à temps est abandonnée et remboursée en silence', async () => {
  const clock = makeClock();
  const refunds = [];
  let settles = 0;
  const { queue, sends } = makeQueue(
    clock,
    () => sleep(clock, 2000), // appel très long : rien d'autre ne peut partir
    { refund: (stake, balls) => refunds.push({ stake, balls }), settled: () => settles++ },
  );
  queue.push(10, 12, 'medium'); // part tout de suite
  await clock.advance(10);
  queue.push(10, 12, 'medium'); // celle-ci attend derrière l'appel en vol
  assert.equal(queue.waiting(), 1);
  await clock.advance(MAX_WAIT_MS + 1);
  assert.equal(queue.waiting(), 0, 'abandonnée au bout de l’attente maximale, sans attendre la réponse');
  assert.deepEqual(refunds, [{ stake: 10, balls: 1 }]);
  assert.ok(settles >= 1, 'un abandon appelle settled() : sans ça la mise rendue ne serait pas réaffichée');
  await clock.advance(5000);
  assert.equal(total(sends), 1, 'elle ne part jamais');
});

test('file : dans un groupe, seules les billes trop vieilles sont abandonnées', async () => {
  const clock = makeClock();
  const refunds = [];
  const { queue } = makeQueue(clock, () => sleep(clock, 2000), { refund: (stake, balls) => refunds.push({ stake, balls }) });
  queue.push(10, 12, 'medium'); // part tout de suite, l'appel dure 2 s : la suite attend derrière
  await clock.advance(10);
  for (let i = 0; i < 3; i++) {
    queue.push(10, 12, 'medium'); // même mise : un seul groupe, trois instants de clic (10, 110, 210)
    await clock.advance(100);
  }
  await clock.advance(105); // t = 415 : seule la bille de t = 10 a dépassé l'attente maximale
  assert.deepEqual(refunds, [{ stake: 10, balls: 1 }], 'un groupe partiellement expiré ne part pas en entier');
  assert.equal(queue.waiting(), 2, 'les deux plus récentes attendent encore leur tour');
  await clock.advance(100); // t = 515 : celle de t = 110 expire à son tour
  assert.deepEqual(refunds, [{ stake: 10, balls: 1 }, { stake: 10, balls: 1 }]);
  assert.equal(queue.waiting(), 1);
});

test('file : clear() pendant un appel en vol empêche le double remboursement de sa réponse', async () => {
  const clock = makeClock();
  const refunds = [];
  const { queue, sends } = makeQueue(clock, async () => (await sleep(clock, 300), { refused: 1 }), {
    refund: (stake, balls) => refunds.push({ stake, balls }),
  });
  queue.push(10, 12, 'medium'); // part tout de suite ; le serveur la refusera
  await clock.advance(10);
  for (let i = 0; i < 3; i++) queue.push(10, 12, 'medium');
  assert.equal(queue.inFlight(), true);
  assert.equal(queue.clear(), 30, 'clear() rend les 3 billes encore en file');
  await clock.advance(2000);
  // La page rend elle-même la mise du groupe en vol (sendGroup) avant d'appeler clear() : si la file la rendait
  // aussi à la réponse, le joueur serait remboursé deux fois. C'est ce que protège le compteur `gen`.
  assert.deepEqual(refunds, [], 'la réponse d’un appel d’avant clear() ne rembourse plus rien');
  assert.equal(sends.length, 1, 'rien ne repart après clear()');
  assert.equal(queue.inFlight(), false);
  assert.equal(queue.waiting(), 0);
});

// ---------------------------------------------------------------- simulation bout en bout

/**
 * Faux serveur : seau de 10 billes rechargé à 10/s (comme casino_plinko_batch), et limite de 8 appels par seconde
 * au-delà de laquelle il répond « doucement : trop d'appels ».
 */
function fakeServer(clock, { latency, callsPerSecond = 8, balance = 1_000_000, random = seeded(12345) } = {}) {
  const calls = [];
  let tokens = BURST;
  let at = clock.now();
  const lag = () => latency[0] + random() * (latency[1] - latency[0]);
  return {
    balance,
    accepted: 0,
    lastAcceptedAt: 0,
    refusedCalls: 0,
    async spin(g) {
      await sleep(clock, lag()); // aller
      const t = clock.now();
      while (calls.length && calls[0] <= t - 1000) calls.shift();
      if (calls.length >= callsPerSecond) {
        this.refusedCalls++;
        await sleep(clock, lag());
        throw new Error('doucement : trop d’appels, réessaie dans un instant.');
      }
      calls.push(t);
      tokens = Math.min(BURST, tokens + ((t - at) * PER_SECOND) / 1000);
      at = t;
      const take = Math.min(g.n, Math.floor(tokens + 1e-9));
      tokens -= take;
      this.accepted += take;
      if (take) this.lastAcceptedAt = t;
      this.balance -= take * g.bet;
      await sleep(clock, lag()); // retour
      return { refused: g.n - take, balance: this.balance };
    },
  };
}

/**
 * Un joueur qui clique, avec le seau du site, la file, l'égrenage (`dropDelays`, comme `sendGroup` dans la page) et
 * le faux serveur branchés ensemble. `drops` est ce que le joueur voit vraiment : l'instant où chaque bille est
 * lâchée sur le plateau. C'est ce que mesure le critère « après le dernier clic, plus rien ne part ».
 */
function makePlayer(clock, { latency, callsPerSecond } = {}) {
  const srv = fakeServer(clock, { latency, callsPerSecond });
  const bucket = tokenBucket(BURST, PER_SECOND, clock.now);
  const gap = 1000 / PER_SECOND;
  const state = { local: srv.balance, clicked: 0, lastClick: 0, drops: [], onRefund: () => {}, srv };
  let nextDrop = 0; // « prochain lâcher possible », commun aux envois, comme dans la page
  /** Égrène les `count` billes d'une réponse, exactement comme la page. */
  const schedule = (count) => {
    const t0 = clock.now();
    const s = dropDelays(nextDrop, t0, count, gap);
    nextDrop = s.next;
    for (const d of s.delays) state.drops.push(t0 + d);
  };
  const { queue, sends } = makeQueue(
    clock,
    async (g) => {
      try {
        const r = await srv.spin(g);
        schedule(g.n - r.refused);
        return r.refused ? { refused: r.refused } : undefined;
      } catch {
        return { refused: g.n }; // « doucement » : plus de réessai, le groupe est rendu
      }
    },
    {
      refund: (stake, balls) => {
        state.local += stake;
        state.onRefund(balls); // le mode auto en fait une dette (voir `autoRapide`)
      },
    },
  );
  state.queue = queue;
  state.sends = sends;
  /** Un clic : accepté par le seau ou ignoré sans rien miser. */
  state.click = () => {
    if (!bucket.take()) return false;
    state.clicked++;
    state.lastClick = clock.now();
    state.local -= 10;
    queue.push(10, 12, 'medium');
    return true;
  };
  /** Clique pendant `seconds` secondes, aussi vite que le site l'autorise. */
  state.spam = async (seconds) => {
    for (let i = 0; i < PER_SECOND * seconds; i++) {
      state.click();
      await clock.advance(1000 / PER_SECOND);
    }
  };
  return state;
}

/**
 * Retard de la **dernière bille lâchée** sur le **dernier clic** : le critère que juge le joueur. Les autres tests
 * mesurent les envois au serveur, pas les lâchers ; c'est pourquoi ils passaient aussi quand la dernière bille d'un
 * envoi de 10 tombait 1,3 s après le dernier clic.
 */
async function retardDeLaDerniereBille(roundTrip, jouer) {
  const clock = makeClock();
  const p = makePlayer(clock, { latency: [roundTrip / 2, roundTrip / 2] }); // aller-retour fixe : mesure reproductible
  await jouer(clock, p);
  await clock.advance(5000);
  assert.ok(p.drops.length, 'des billes ont bien été lâchées');
  return { retard: Math.max(...p.drops) - p.lastClick, p };
}

/** Seau plein, 10 clics en 50 ms, puis plus rien. */
const seauPlein = async (clock, p) => {
  for (let i = 0; i < BURST; i++) {
    p.click();
    await clock.advance(5);
  }
};
/** Rafale soutenue : 10 clics par seconde pendant 4 s. */
const rafale = (clock, p) => p.spam(4);

/**
 * Budget du retard : l'appel déjà en vol (un aller-retour), l'envoi suivant (écart minimal + un aller-retour) et
 * la fenêtre d'égrenage. Rien d'autre n'a le droit de s'ajouter — surtout pas un égrenage qui déborde.
 */
const budgetRetard = (roundTrip) => MAX_LEAD_MS + MIN_GAP_MS + 2 * roundTrip;

test('bout en bout : après le dernier clic, la dernière bille tombe dans le budget', async () => {
  for (const roundTrip of [50, 250, 600]) {
    for (const [nom, jouer] of [['seau plein', seauPlein], ['rafale de 4 s', rafale]]) {
      const { retard } = await retardDeLaDerniereBille(roundTrip, jouer);
      const budget = budgetRetard(roundTrip);
      // Repères (aller-retour 50 / 250 / 600 ms) : seau plein 511 / 811 / 555 ms, rafale 200 / 500 / 900 ms.
      // Avant l'égrenage resserré, le seau plein donnait 955 et 1255 ms : ce test échouait.
      assert.ok(retard <= budget, `${nom}, aller-retour ${roundTrip} ms : dernière bille ${Math.round(retard)} ms après le dernier clic (budget ${budget} ms)`);
    }
  }
});

/**
 * Mode auto en vitesse rapide, calqué sur la boucle de `plinko.ts` (qui ne s'importe pas ici : elle tient au DOM).
 * `dettes` reproduit le compteur `owed` : une bille payée au clic mais jamais tombée (abandonnée dans la file ou
 * refusée par le serveur) rend son tour, au lieu de le consommer. Sans lui, « Auto ×N » joue moins de N billes.
 */
async function autoRapide(clock, p, tours, { dettes = true } = {}) {
  let owed = 0;
  p.onRefund = (balls) => (owed += balls);
  const fin = clock.now() + 120000; // garde-fou : un test ne doit jamais tourner sans fin
  let left = tours;
  while (left > 0 && clock.now() < fin) {
    left--;
    for (;;) {
      if (p.click()) {
        await clock.advance(1000 / PER_SECOND);
        // Dernier tour : on laisse tout retomber avant de conclure, sinon une bille abandonnée au tout dernier
        // moment n'aurait plus de tour pour être rejouée.
        if (dettes && !owed && !left) {
          while ((p.queue.waiting() || p.queue.inFlight()) && clock.now() < fin) await clock.advance(20);
        }
        if (!dettes || !owed) break; // le tour est joué
        owed--; // ce clic remplace une bille qui n'est jamais tombée
      } else {
        await clock.advance(20); // plus de jeton : on attend au lieu d'arrêter l'auto
      }
      if (clock.now() >= fin) break;
    }
  }
  await clock.advance(5000); // tout retombe
  return { duree: Math.round(clock.now()) };
}

test('auto : « ×100 » joue 100 billes, quelle que soit la connexion', async () => {
  for (const roundTrip of [100, 400, 800]) {
    const clock = makeClock();
    const p = makePlayer(clock, { latency: [roundTrip / 2, roundTrip / 2] });
    await autoRapide(clock, p, 100);
    // Sans le compteur de dettes : 100 / 76 / 37 billes jouées à 100 / 400 / 800 ms d'aller-retour.
    assert.equal(p.srv.accepted, 100, `aller-retour ${roundTrip} ms : ${p.srv.accepted} billes jouées sur 100 demandées`);
    assert.equal(p.local, p.srv.balance, `aller-retour ${roundTrip} ms : le solde local retombe sur celui du serveur`);
    assert.equal(p.queue.waiting(), 0);
  }
});

test('scénario du joueur : rafale, arrêt, puis un seul clic → une seule bille part', async () => {
  const clock = makeClock();
  const p = makePlayer(clock, { latency: [30, 300] });
  await p.spam(4);
  // Le joueur s'arrête : au-delà de l'appel en vol et de l'envoi en préparation, plus rien ne doit partir.
  const atStop = total(p.sends);
  await clock.advance(MAX_WAIT_MS + 400);
  const after = total(p.sends) - atStop;
  // Borne mesurée : 2 billes avec cette graine. On s'autorise un envoi complet (10), pas deux : l'appel en vol se
  // termine, l'envoi en préparation part, et tout ce qui reste est abandonné avant un troisième départ.
  assert.ok(after <= BURST, `${after} billes parties après le dernier clic : au plus l’envoi en préparation`);
  const retard = Math.max(...p.drops) - p.lastClick;
  assert.ok(retard <= budgetRetard(600), `dernière bille lâchée ${Math.round(retard)} ms après le dernier clic`);
  assert.equal(p.queue.waiting(), 0, 'rien n’est gardé en file');
  const settled = total(p.sends);

  // Plus tard, un seul clic.
  await clock.advance(1000);
  assert.equal(total(p.sends), settled, 'rien ne part pendant le silence');
  assert.equal(p.click(), true);
  await clock.advance(3000);
  assert.equal(total(p.sends) - settled, 1, 'un clic = une bille, pas deux');
  assert.equal(p.local, p.srv.balance, 'le solde local retombe sur celui du serveur');
});

test('scénario du joueur : rien ne part plus passé l’attente maximale après le dernier clic', async () => {
  const clock = makeClock();
  const p = makePlayer(clock, { latency: [30, 300] });
  await p.spam(6);
  const stop = clock.now();
  await clock.advance(5000);
  const late = p.sends.filter((s) => s.at > stop + MAX_WAIT_MS + 600); // attente maximale + un aller-retour
  assert.deepEqual(late, [], 'aucun envoi tardif');
  assert.equal(p.queue.waiting(), 0);
  assert.equal(p.local, p.srv.balance);
});

test('simulation : réseau lent (30-300 ms), ≈ 10 billes/s et solde local juste', async () => {
  const clock = makeClock();
  const p = makePlayer(clock, { latency: [30, 300] });
  await p.spam(6);
  await clock.advance(2000);
  assert.equal(p.clicked, PER_SECOND * 6, `${p.clicked} clics acceptés par le seau`);
  // Aller-retour jusqu'à 600 ms : quelques billes dépassent l'attente maximale et sont abandonnées plutôt que
  // gardées (55 sur 60 avec cette graine, soit ≈ 9,2 billes/s). C'est le prix assumé du « rien n'est gardé ».
  assert.ok(p.srv.accepted >= 0.9 * p.clicked, `${p.srv.accepted} billes jouées sur ${p.clicked} cliquées`);
  assert.ok(p.srv.lastAcceptedAt <= 6500, `dernière bille jouée à ${Math.round(p.srv.lastAcceptedAt)} ms : le débit suit les clics`);
  assert.equal(p.local, p.srv.balance, 'le solde local retombe sur celui du serveur');
  assert.equal(p.queue.waiting(), 0);
});

test('simulation : réseau rapide (10-40 ms), ≈ 10 billes/s, aucune bille perdue', async () => {
  const clock = makeClock();
  const p = makePlayer(clock, { latency: [10, 40] });
  await p.spam(6);
  await clock.advance(2000);
  assert.equal(p.clicked, PER_SECOND * 6, `${p.clicked} clics acceptés par le seau`);
  assert.equal(p.srv.accepted, p.clicked, 'aucune bille perdue : c’est ce que protège l’écart de 150 ms');
  assert.ok(p.srv.lastAcceptedAt <= 6500, `dernière bille jouée à ${Math.round(p.srv.lastAcceptedAt)} ms : le débit suit les clics`);
  assert.equal(p.srv.refusedCalls, 0, 'le site ne dépasse jamais 8 appels par seconde');
  assert.equal(p.local, p.srv.balance);
  assert.equal(p.queue.waiting(), 0);
});
