// L'API : CORS pour le site, taille des requêtes bornée, joueur identifié, puis les routes de chaque domaine.
// Construite à partir de ses dépendances (base, vérification des jetons) pour être testée sans réseau.

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { appartController } from './appart/appart.controller';
import { AppartService } from './appart/appart.service';
import type { Db } from './db';
import { requireUser, type Auth, type Verify } from './http/auth';
import { AppError, toAppError } from './http/errors';

export function createApp(deps: { db: Db; verify: Verify; origins: string[] }) {
  const app = new Hono<Auth>();
  app.use('*', cors({ origin: deps.origins, allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], allowHeaders: ['authorization', 'content-type'], maxAge: 600 }));
  app.get('/health', (c) => c.json({ ok: true }));
  app.use('*', bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json({ error: 'requête trop grosse' }, 413) }));
  app.use('*', requireUser(deps.verify));
  app.route('/', appartController(new AppartService(deps.db)));
  app.notFound((c) => c.json({ error: 'route inconnue' }, 404));
  app.onError((e, c) => {
    const err = toAppError(e);
    if (err.status === 500 && !(e instanceof AppError)) console.error(e);
    return c.json({ error: err.message }, err.status);
  });
  return app;
}
