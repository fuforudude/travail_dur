// Appart : routes HTTP. Lit la requête, appelle le service, renvoie du JSON ; aucune règle ici.

import { Hono } from 'hono';
import type { Auth } from '../http/auth';
import { bad } from '../http/errors';
import type { AppartService } from './appart.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Corps JSON de la requête (un objet), sinon erreur 400. */
async function body(req: Request): Promise<Record<string, unknown>> {
  const b: unknown = await req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('requête invalide');
  return b as Record<string, unknown>;
}

export function appartController(service: AppartService) {
  return (
    new Hono<Auth>()
      // L'appart d'un joueur (« me » pour le sien) : aménagement, revenus, photos ; chez soi, meubles et photos débloquées.
      .get('/appart/:owner', async (c) => {
        const owner = c.req.param('owner') === 'me' ? c.get('uid') : c.req.param('owner');
        if (!UUID.test(owner)) throw bad('joueur inconnu');
        return c.json(await service.view(c.get('uid'), owner));
      })
      .post('/appart/clean', async (c) => c.json(await service.clean(c.get('uid'))))
      .post('/appart/collect', async (c) => c.json(await service.collect(c.get('uid'))))
      .post('/appart/rooms', async (c) => c.json(await service.buyRoom(c.get('uid'), (await body(c.req.raw)).room)))
      .post('/appart/specials', async (c) => c.json(await service.buySpecial(c.get('uid'), (await body(c.req.raw)).special)))
      .put('/appart/layout', async (c) => c.json(await service.save(c.get('uid'), (await body(c.req.raw)).layout)))
      .post('/furniture', async (c) => c.json(await service.buyFurniture(c.get('uid'), (await body(c.req.raw)).base)))
      .delete('/furniture/:id', async (c) => c.json(await service.sellFurniture(c.get('uid'), Number(c.req.param('id')))))
  );
}
