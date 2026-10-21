// Base de test : toutes les migrations rejouées dans PGlite (Postgres en mémoire, comme scripts/sql-test.mjs),
// derrière la même interface Db que la production, et l'API complète avec un jeton = l'identifiant du joueur.

import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/app';
import type { Db } from '../src/db';

const root = join(import.meta.dirname, '..', '..');

// int8 et numeric en nombres, comme le fait pgDb() en production.
const parsers = { 20: Number, 1700: Number };

const wrap = (q: PGlite | Transaction, inTx: boolean): Db => ({
  query: async (text, params) => (await q.query(text, params, { parsers })).rows as never,
  // PGlite n'a qu'une connexion : une transaction imbriquée réutilise la courante.
  tx: (fn) => (inTx ? fn(wrap(q, true)) : (q as PGlite).transaction((t) => fn(wrap(t, true)))),
});

export async function testDb() {
  const pg = new PGlite();
  await pg.exec(readFileSync(join(root, 'supabase', 'tests', 'bootstrap.sql'), 'utf8'));
  for (const f of readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort())
    await pg.exec(readFileSync(join(root, 'supabase', 'migrations', f), 'utf8'));
  const db = wrap(pg, false);
  const app = createApp({ db, verify: async (token) => token, origins: ['http://localhost'] });
  return {
    pg,
    db,
    async user(points = 0): Promise<string> {
      const [u] = await db.query<{ id: string }>('insert into auth.users (is_anonymous) values (true) returning id');
      if (points) await db.query(`select public.points_add($1, $2, 'test', 'bonus')`, [u.id, points]);
      return u.id;
    },
    /** Appel de l'API par le joueur `uid` ; renvoie le statut et le JSON. */
    async call<T = any>(uid: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
      const res = await app.request(path, {
        method,
        headers: { ...(uid ? { authorization: `Bearer ${uid}` } : {}), 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as T };
    },
    balance: async (uid: string) => Number((await db.query<{ balance: number }>('select balance from public.wallets where user_id = $1', [uid]))[0]?.balance ?? 0),
  };
}
