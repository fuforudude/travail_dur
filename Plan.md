# État du projet et repères de maintenance

Ce document remplace le plan initial de la V1, désormais dépassé. Le descriptif fonctionnel à jour,
les commandes de lancement, le déploiement et la configuration Supabase sont dans [README.md](./README.md).

## Architecture actuelle

- **Application web** : Vite et TypeScript sans framework UI. `src/main.ts` initialise les services,
  enregistre les routes et charge les pages secondaires à la demande via `src/router.ts`.
- **Interface** : `src/ui/` assemble les écrans et `src/core/` centralise les services du navigateur
  (clavier, stockage local, réglages, son et touche panique).
- **Jeux** : chaque jeu implémente le contrat `Game` de `src/games/types.ts`, puis est référencé dans
  `src/games/registry.ts`. Les jeux de plateau partagent des vues via `duel.ts` et `board.ts`.
- **Réseau** : `src/net/` regroupe le client Supabase, les comptes, salons, classements, amis et
  autres services en ligne. Sans configuration Supabase, les fonctions solo restent disponibles.
- **Serveur** : les migrations `supabase/migrations/` définissent le schéma, les politiques RLS et
  les fonctions SQL d’autorité. Deux fonctions Edge : `supabase/functions/td/` (rejeu des vagues du
  tower defense) et `supabase/functions/board4/` (coups des jeux à 4 : échecs à 4, corridor à 4).

## Invariants à préserver

- Le navigateur ne décide jamais des scores classés, des points, des achats, des coups en ligne ou de
  la progression de compte : les données sensibles sont vérifiées et enregistrées côté serveur.
- Les règles des jeux en ligne existent parfois en double, en TypeScript et en SQL. En particulier,
  les jeux de plateau côté client doivent rester cohérents avec `match_play` dans
  `supabase/migrations/0006_plateaux.sql`.
- Les moteurs du Tower Defense et des jeux à 4 sont une exception au code dupliqué : le serveur
  embarque une copie générée du moteur navigateur. Modifier `src/games/towerdefense/engine/` ou
  `src/games/four/engine/`, puis exécuter `npm run td:sync` (également fait par `npm run build`,
  voir `scripts/td-sync.mjs`). Ne pas modifier directement les copies dans
  `supabase/functions/td/engine/` et `supabase/functions/board4/engine/`.
- Une migration déjà appliquée en production ne se réécrit pas : toute évolution de schéma ou de
  fonction SQL passe par un nouveau fichier numéroté dans `supabase/migrations/`. Le README détaille
  l’ordre d’application et les opérations de déploiement.
- Les sauvegardes locales servent au confort/hors-ligne, pas de preuve au serveur. Toujours vérifier
  les entrées du client avant de s’en servir pour une décision de compte.

## Vérification avant livraison

- `npm run build` synchronise les moteurs partagés (`td:sync`), vérifie les types TypeScript puis
  construit le site dans `dist/`.
- `npm run test:sql` rejoue toutes les migrations dans PGlite et vérifie les droits et les règles de
  sécurité (`scripts/sql-test.mjs`). `npm run test:site` lance les tests des fonctions pures du site
  (`src/**/*.test.mjs`). Il n'y a pas de lint ni de commande unique `verifier`.
- La CI (`.github/workflows/tests.yml`) exécute `test:sql`, `test:site`, vérifie que la copie des
  moteurs est à jour (`npm run td:sync` puis `git diff --exit-code supabase/functions`) et lance
  `npx tsc`, sur chaque push et chaque PR.
- Le déploiement des fonctions Edge est automatique : à chaque push sur `main` qui touche `supabase/`
  ou un moteur partagé, `.github/workflows/supabase.yml` lance `test:sql`, applique les migrations
  (`supabase db push --linked --include-all`), puis redéploie `td` et `board4`. Un parcours manuel
  reste utile pour les parcours d'interface touchés (modes hors ligne et Supabase), et pour la CSP :
  vérifier sur le build de production (`npm run build`, puis `npx vite preview`).

## Décisions structurantes

Les décisions d'architecture sont consignées dans `docs/adr/`.
