// Démarrage de l'API sur le VPS : lit la configuration (variables d'environnement, voir server/README.md)
// et écoute en local ; Caddy, devant, s'occupe du HTTPS.

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { pgDb } from './db';
import { supabaseVerifier } from './http/auth';

function env(name: string, fallback?: string): string {
  const v = process.env[name]?.trim() || fallback;
  if (!v) throw new Error(`variable d'environnement manquante : ${name}`);
  return v;
}

const db = pgDb(env('DATABASE_URL'));
const app = createApp({
  db,
  verify: supabaseVerifier(env('SUPABASE_URL').replace(/\/+$/, ''), process.env.SUPABASE_JWT_SECRET?.trim() || undefined),
  origins: env('ALLOWED_ORIGINS', 'https://fuforudude.github.io,http://localhost:5173').split(',').map((o) => o.trim()),
});

const port = Number(env('PORT', '8787'));
const server = serve({ fetch: app.fetch, port, hostname: env('HOST', '127.0.0.1') }, () => console.log(`API prête sur le port ${port}`));

// Arrêt propre (systemd, redéploiement) : finir les requêtes en cours, puis fermer la base.
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    server.close(() => void db.close().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
