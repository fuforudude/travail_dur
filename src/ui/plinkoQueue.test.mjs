// Tests des fonctions pures du Plinko en rafale (seau à jetons, file d'envoi), lanceur intégré de Node :
//   npm run test:site
// Fichier en .mjs : Node 22+ enlève lui-même les types de plinkoQueue.ts, sans dépendance ni compilation.
import test from 'node:test';
import assert from 'node:assert/strict';

import { batchQueue, BURST, MAX_RETRIES, MIN_GAP_MS, PER_SECOND, tokenBucket } from './plinkoQueue.ts';

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

// ---------------------------------------------------------------- seau à jetons

test('seau : 15 billes d’un coup, puis refus', () => {
  let t = 0;
  const b = tokenBucket(BURST, PER_SECOND, () => t);
  for (let i = 0; i < BURST; i++) assert.equal(b.take(), true, `bille ${i + 1}`);
  assert.equal(b.take(), false, '16e bille refusée');
});

test('seau : recharge de 15 jetons par seconde', () => {
  let t = 0;
  const b = tokenBucket(BURST, PER_SECOND, () => t);
  for (let i = 0; i < BURST; i++) b.take();
  t += 1000 / PER_SECOND;
  assert.equal(b.take(), true, 'un jeton regagné au bout de 1/15 s');
  assert.equal(b.take(), false, 'pas deux');
  t += 1000;
  for (let i = 0; i < BURST; i++) assert.equal(b.take(), true, 'seau plein au bout d’une seconde');
  assert.equal(b.take(), false, 'jamais plus que la capacité');
});

test('seau : 15 billes/s pendant 3 minutes, aucun blocage par arrondi', () => {
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
  assert.equal(sends.reduce((t, s) => t + s.n, 0), 40, 'toutes les billes envoyées');
  assert.equal(queue.waiting(), 0);
});

test('file : regroupement au plus 15 billes, une seule mise par envoi', async () => {
  const clock = makeClock();
  const { queue, sends } = makeQueue(clock, () => sleep(clock, 500));
  for (let i = 0; i < 40; i++) queue.push(10, 12, 'medium');
  await clock.advance(10000);
  assert.equal(sends.length, 4, '1 bille tout de suite, puis 15, 15 et 9');
  assert.deepEqual(sends.map((s) => s.n), [1, 15, 15, 9]);
  for (const s of sends) assert.ok(s.n <= BURST, 'jamais plus de 15 par appel');
  assert.deepEqual([...new Set(sends.map((s) => s.bet))], [10], 'une seule mise par envoi');
});

test('file : un changement de mise ouvre un envoi séparé', async () => {
  const clock = makeClock();
  const { queue, sends } = makeQueue(clock, () => sleep(clock, 500));
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
  const { queue } = makeQueue(clock, () => sleep(clock, 500));
  queue.push(10, 12, 'medium'); // partie tout de suite, pas remboursée
  for (let i = 0; i < 4; i++) queue.push(10, 12, 'medium');
  for (let i = 0; i < 3; i++) queue.push(20, 12, 'medium');
  assert.equal(queue.waiting(), 7);
  assert.equal(queue.clear(), 4 * 10 + 3 * 20);
  assert.equal(queue.waiting(), 0);
  await clock.advance(10000);
  assert.equal(clock.count(), 0, 'aucun minuteur ne reste en place');
});

test('file : une erreur de send ne bloque pas la suite', async () => {
  const clock = makeClock();
  let calls = 0;
  const { queue, sends } = makeQueue(clock, async () => {
    await sleep(clock, 20);
    if (++calls === 1) throw new Error('réseau');
  });
  for (let i = 0; i < 20; i++) queue.push(10, 12, 'medium');
  await clock.advance(5000);
  assert.equal(sends.reduce((t, s) => t + s.n, 0), 20);
  assert.equal(queue.waiting(), 0);
  assert.equal(queue.inFlight(), false);
});

test('file : « trop d’appels » renvoie le groupe, puis abandonne au bout de 3 réessais', async () => {
  const clock = makeClock();
  let refunded = 0;
  const { queue, sends } = makeQueue(clock, async () => {
    await sleep(clock, 20);
    return { retry: true };
  }, { refund: (s) => (refunded += s) });
  queue.push(10, 12, 'medium');
  queue.push(10, 12, 'medium');
  await clock.advance(5000);
  assert.equal(sends.length, 1 + MAX_RETRIES + 1 + MAX_RETRIES, 'chaque groupe est tenté 1 fois puis réessayé 3 fois');
  assert.equal(refunded, 20, 'les deux mises sont rendues');
  assert.equal(queue.waiting(), 0);
  for (let i = 1; i < sends.length; i++) assert.ok(sends[i].at - sends[i - 1].at >= MIN_GAP_MS, 'les réessais respectent l’écart');
});

test('file : un groupe qui finit par passer n’est pas abandonné', async () => {
  const clock = makeClock();
  let refunded = 0;
  let calls = 0;
  const { queue, sends } = makeQueue(clock, async () => {
    await sleep(clock, 20);
    return ++calls <= MAX_RETRIES ? { retry: true } : undefined;
  }, { refund: (s) => (refunded += s) });
  queue.push(10, 12, 'medium');
  await clock.advance(5000);
  assert.equal(sends.length, MAX_RETRIES + 1);
  assert.equal(refunded, 0);
});

test('file : les billes refusées par le serveur repartent dans l’envoi suivant', async () => {
  const clock = makeClock();
  let refunded = 0;
  let calls = 0;
  const { queue, sends } = makeQueue(clock, async () => {
    await sleep(clock, 20);
    return ++calls === 2 ? { requeue: 4 } : undefined; // 4 des 5 billes du 2e envoi refusées
  }, { refund: (s) => (refunded += s) });
  for (let i = 0; i < 6; i++) queue.push(10, 12, 'medium');
  await clock.advance(5000);
  assert.deepEqual(sends.map((s) => s.n), [1, 5, 4]);
  assert.equal(refunded, 0, 'une bille refusée repart, elle n’est pas remboursée');
  assert.equal(queue.waiting(), 0);
});

test('file : des billes refusées sans fin finissent par être remboursées', async () => {
  const clock = makeClock();
  let refunded = 0;
  const { queue, sends } = makeQueue(clock, async (g) => {
    await sleep(clock, 20);
    return { requeue: g.n }; // le serveur refuse tout : aucune progression
  }, { refund: (s) => (refunded += s) });
  queue.push(10, 12, 'medium');
  await clock.advance(5000);
  assert.equal(sends.length, MAX_RETRIES + 1);
  assert.equal(refunded, 10);
});

// ---------------------------------------------------------------- simulation bout en bout

/**
 * Faux serveur : seau de 15 billes rechargé à 15/s (comme casino_plinko_batch), et limite de 8 appels par seconde
 * au-delà de laquelle il répond « doucement : trop d'appels ».
 */
function fakeServer(clock, { latency, callsPerSecond = 8, balance = 1_000_000 } = {}) {
  const calls = [];
  let tokens = BURST;
  let at = clock.now();
  const lag = () => latency[0] + Math.random() * (latency[1] - latency[0]);
  return {
    balance,
    accepted: 0,
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
      this.balance -= take * g.bet;
      await sleep(clock, lag()); // retour
      return { refused: g.n - take, balance: this.balance };
    },
  };
}

/** Rafale de `seconds` secondes à 15 clics/s, comme Espace maintenue ou l'auto rapide. */
async function burst(latency, seconds) {
  const clock = makeClock();
  const srv = fakeServer(clock, { latency });
  let local = srv.balance;
  const bucket = tokenBucket(BURST, PER_SECOND, clock.now);
  const { queue } = makeQueue(
    clock,
    async (g) => {
      try {
        const r = await srv.spin(g);
        return r.refused ? { requeue: r.refused } : undefined;
      } catch {
        return { retry: true };
      }
    },
    { refund: (s) => (local += s) },
  );
  let clicked = 0;
  for (let i = 0; i < PER_SECOND * seconds; i++) {
    if (bucket.take()) {
      clicked++;
      local -= 10;
      queue.push(10, 12, 'medium');
    }
    await clock.advance(1000 / PER_SECOND);
  }
  await clock.advance(5000); // le temps que la file se vide
  return { clicked, srv, local, queue, clock };
}

test('simulation : réseau lent (30-300 ms), ≈ 15 billes/s et solde local juste', async () => {
  const { clicked, srv, local, queue } = await burst([30, 300], 6);
  assert.ok(clicked >= 15 * 6, `${clicked} clics acceptés par le seau`);
  assert.equal(srv.accepted, clicked, 'toutes les billes cliquées sont jouées');
  assert.equal(local, srv.balance, 'le solde local retombe sur celui du serveur');
  assert.equal(queue.waiting(), 0);
});

test('simulation : réseau rapide (10-40 ms), toujours ≈ 15 billes/s, aucune bille perdue', async () => {
  const { clicked, srv, local, queue } = await burst([10, 40], 6);
  assert.ok(clicked >= 15 * 6, `${clicked} clics acceptés par le seau`);
  assert.equal(srv.accepted, clicked, 'aucune bille perdue : c’est ce que corrige l’écart de 150 ms');
  assert.equal(srv.refusedCalls, 0, 'le site ne dépasse jamais 8 appels par seconde');
  assert.equal(local, srv.balance);
  assert.equal(queue.waiting(), 0);
});
