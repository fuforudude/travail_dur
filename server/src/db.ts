// Accès à Postgres : une interface minimale (requête, transaction), branchée sur pg en production
// et sur PGlite dans les tests. Les dépôts (*.repo.ts) ne connaissent que cette interface.

import pg from 'pg';

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Transaction : tout est écrit, ou rien. Dans une transaction, `tx` réutilise la même. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

// bigint et numeric arrivent en texte (pour ne rien perdre) : les soldes et revenus tiennent dans un Number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);

/** Base Supabase, par son adresse de connexion (pooler en mode transaction, port 6543). */
export function pgDb(url: string): Db & { close(): Promise<void> } {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  const on = (c: pg.PoolClient): Db => ({
    query: async (text, params) => (await c.query(text, params)).rows,
    tx: (fn) => fn(on(c)),
  });
  return {
    query: async (text, params) => (await pool.query(text, params)).rows,
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const out = await fn(on(c));
        await c.query('commit');
        return out;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
