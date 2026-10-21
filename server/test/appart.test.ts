// API de l'appart, de bout en bout : requête HTTP → contrôleur → service → dépôt → Postgres (PGlite).
// Vérifie aussi que le catalogue partagé (shared/furniture.ts) est identique à celui de la base.

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { apartmentRate, BASES, CLEAN_TASKS, FINISHES, itemIncome, ROOM_COSTS, ROOMS, SPECIALS } from '../../shared/furniture';
import { testDb } from './helpers';

let t: Awaited<ReturnType<typeof testDb>>;
before(async () => {
  t = await testDb();
});

describe('catalogue partagé = base', () => {
  test('modèles de meubles', async () => {
    const rows = await t.db.query<{ id: string; place: string; w: number; h: number; price: number }>('select id, place, w, h, price from public.furniture_bases order by id');
    const shared = BASES.map(({ id, place, w, h, price }) => ({ id, place, w, h, price })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(rows.map((r) => ({ ...r, price: Number(r.price) })), shared);
  });
  test('finitions et revenus par rareté', async () => {
    const rows = await t.db.query<{ id: string; rarity: string }>('select id, rarity from public.furniture_finishes order by id');
    assert.deepEqual(rows, FINISHES.map(({ id, rarity }) => ({ id, rarity })).sort((a, b) => a.id.localeCompare(b.id)));
    for (const f of FINISHES) {
      const layout = { entree: { floor: [{ o: 1, i: `chair:${f.id}`, x: 0, y: 0 }], wall: [] } };
      const [r] = await t.db.query<{ rate: number }>('select public.apartment_rate($1::jsonb, 0) as rate', [JSON.stringify(layout)]);
      assert.equal(Number(r.rate), itemIncome(`chair:${f.id}`), f.id);
    }
  });
  test('pièces, portes, prix, équipements, ménage', async () => {
    for (const room of ROOMS) {
      const [info] = await t.db.query<{ w: number; d: number }>('select w, d from public.apartment_room($1)', [room.id]);
      assert.deepEqual({ w: info.w, d: info.d }, { w: room.w, d: room.d }, room.id);
      const [doors] = await t.db.query<{ x: number[] }>('select public.apartment_room_doors($1) as x', [room.id]);
      assert.deepEqual(doors.x, room.doors.map((d) => d.x), room.id);
      const [lux] = await t.db.query<{ price: number | null; requires: string | null }>('select price, requires from public.apartment_room_luxury($1)', [room.id]);
      assert.deepEqual({ price: lux.price === null ? undefined : Number(lux.price), requires: lux.requires ?? undefined }, { price: room.price, requires: room.requires }, room.id);
    }
    const sp = await t.db.query('select id, room, name, cost, x, y, w, h from public.apartment_specials() order by id');
    assert.deepEqual(sp.map((s: any) => ({ ...s, cost: Number(s.cost) })), SPECIALS.map(({ id, room, name, cost, x, y, w, h }) => ({ id, room, name, cost, x, y, w, h })).sort((a, b) => a.id.localeCompare(b.id)));
    for (let i = 0; i < CLEAN_TASKS.length; i++) assert.equal(Number((await t.db.query<{ c: number }>('select public.apartment_clean_cost($1) as c', [i]))[0].c), CLEAN_TASKS[i].cost);
    for (let i = 0; i < ROOM_COSTS.length; i++) assert.equal(Number((await t.db.query<{ c: number }>('select public.apartment_room_cost($1) as c', [i]))[0].c), ROOM_COSTS[i]);
  });
});

describe('API appart', () => {
  test('sans jeton : 401', async () => {
    assert.equal((await t.call(null, 'GET', '/appart/me')).status, 401);
  });

  test('ménage, achat, aménagement, revenus, revente, pièces', async () => {
    const me = await t.user(50_000);
    const start = await t.balance(me);

    // Avant le ménage, on ne meuble pas.
    const tooSoon = await t.call(me, 'PUT', '/appart/layout', { layout: { entree: { floor: [], wall: [] } } });
    assert.equal(tooSoon.status, 400);
    for (let i = 0; i < CLEAN_TASKS.length; i++) assert.equal((await t.call(me, 'POST', '/appart/clean')).status, 200);
    assert.equal((await t.call(me, 'POST', '/appart/clean')).status, 400, 'déjà tout propre');
    const cleaned = CLEAN_TASKS.reduce((s, c) => s + c.cost, 0);
    assert.equal(await t.balance(me), start - cleaned);

    // Deux chaises : achetées, posées côte à côte ; la même case deux fois est refusée.
    const c1 = (await t.call(me, 'POST', '/furniture', { base: 'chair' })).json.owned.id;
    const c2 = (await t.call(me, 'POST', '/furniture', { base: 'chair' })).json.owned.id;
    const clash = await t.call(me, 'PUT', '/appart/layout', { layout: { entree: { floor: [{ o: c1, x: 0, y: 0 }, { o: c2, x: 0, y: 0 }], wall: [] } } });
    assert.deepEqual([clash.status, clash.json.error], [400, 'deux meubles au même endroit']);
    const door = await t.call(me, 'PUT', '/appart/layout', { layout: { entree: { floor: [], wall: [{ o: c1, x: 2, y: 0 }] } } });
    assert.deepEqual([door.status, door.json.error], [400, 'ce meuble ne va pas là']);
    const saved = await t.call(me, 'PUT', '/appart/layout', { layout: { entree: { floor: [{ o: c1, x: 0, y: 0 }, { o: c2, x: 1, y: 0, r: 1 }], wall: [] } } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.apartment.layout.entree.floor, [
      { o: c1, i: 'chair:standard', x: 0, y: 0 },
      { o: c2, i: 'chair:standard', x: 1, y: 0, r: 1 },
    ]);
    // Le taux de l'API, celui du calcul partagé et celui du déclencheur SQL sont les mêmes.
    const rate = apartmentRate(saved.json.apartment.layout, CLEAN_TASKS.length, []);
    assert.equal(saved.json.apartment.rate, rate);
    assert.equal(Number((await t.db.query<{ rate: number }>('select rate from public.apartments where user_id = $1', [me]))[0].rate), rate);

    // Un meuble posé ne se vend pas ; rangé, il rapporte 67 % de son prix.
    assert.equal((await t.call(me, 'DELETE', `/furniture/${c2}`)).status, 400);
    await t.call(me, 'PUT', '/appart/layout', { layout: { entree: { floor: [{ o: c1, x: 0, y: 0 }], wall: [] } } });
    const before = await t.balance(me);
    const sold = await t.call(me, 'DELETE', `/furniture/${c2}`);
    assert.deepEqual([sold.status, sold.json.price], [200, 100]);
    assert.equal(await t.balance(me), before + 100);
    assert.equal((await t.call(me, 'DELETE', `/furniture/${c2}`)).status, 404, 'déjà vendu');

    // Une heure plus tard, la récolte verse une heure de revenus.
    await t.db.query(`update public.apartments set last_tick = now() - interval '1 hour' where user_id = $1`, [me]);
    const got = await t.call(me, 'POST', '/appart/collect');
    const perHour = apartmentRate({ entree: { floor: [{ o: c1, i: 'chair:standard', x: 0, y: 0 }], wall: [] } }, CLEAN_TASKS.length, []);
    assert.ok(Math.abs(got.json.gain - perHour) <= 1, `gain ${got.json.gain} ≠ ${perHour}`);
    assert.equal((await t.call(me, 'POST', '/appart/collect')).json.gain, 0);

    // Pièces : la luxueuse attend sa voisine ; la normale coûte le premier prix de la suite.
    const bar = await t.call(me, 'POST', '/appart/rooms', { room: 'bar' });
    assert.deepEqual([bar.status, bar.json.error], [400, 'débloque d’abord : Salle de jeux']);
    const salon = await t.call(me, 'POST', '/appart/rooms', { room: 'salon' });
    assert.equal(salon.status, 200);
    assert.deepEqual(salon.json.apartment.rooms, ['entree', 'salon']);
    assert.equal(salon.json.balance, (await t.balance(me)));
    assert.equal((await t.call(me, 'POST', '/appart/rooms', { room: 'salon' })).status, 400, 'déjà débloquée');
  });

  test('pas assez de points', async () => {
    const poor = await t.user();
    const r = await t.call(poor, 'POST', '/furniture', { base: 'trophy' });
    assert.deepEqual([r.status, r.json.error], [400, 'pas assez de points']);
  });

  test('visite : réservée aux amis, sans l’inventaire', async () => {
    const owner = await t.user();
    const stranger = await t.user();
    const friend = await t.user();
    assert.equal((await t.call(stranger, 'GET', `/appart/${owner}`)).status, 403);
    const [a, b] = [owner, friend].sort();
    await t.db.query('insert into public.friendships (a, b, requested_by, accepted) values ($1, $2, $1, true)', [a, b]);
    const seen = await t.call(friend, 'GET', `/appart/${owner}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.json.furniture, undefined);
    assert.ok((await t.call(owner, 'GET', '/appart/me')).json.furniture);
  });
});
