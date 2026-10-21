// Identité du joueur : le jeton de connexion Supabase (en-tête Authorization: Bearer …), vérifié ici.
// Clés de signature asymétriques du projet (JWKS), ou ancien secret partagé HS256 si SUPABASE_JWT_SECRET est défini.

import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from './errors';

export type Auth = { Variables: { uid: string } };

export type Verify = (token: string) => Promise<string>;

/** Vérifie un jeton et renvoie l'identifiant du joueur. */
export function supabaseVerifier(supabaseUrl: string, jwtSecret?: string): Verify {
  const issuer = `${supabaseUrl}/auth/v1`;
  const key: Uint8Array | JWTVerifyGetKey = jwtSecret ? new TextEncoder().encode(jwtSecret) : createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, key as JWTVerifyGetKey, { issuer, audience: 'authenticated' });
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('jeton sans joueur');
    return payload.sub;
  };
}

export const requireUser = (verify: Verify) =>
  createMiddleware<Auth>(async (c, next) => {
    const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new AppError(401, 'non connecté');
    let uid: string;
    try {
      uid = await verify(token);
    } catch {
      throw new AppError(401, 'connexion expirée : recharge la page');
    }
    c.set('uid', uid);
    await next();
  });
