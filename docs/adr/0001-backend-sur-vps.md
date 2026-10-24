# 0001. Sortir le backend sur un VPS, devant Supabase

Date : 2026-10-21
Statut : acceptée

## Contexte
Les règles métier existent en double : en TypeScript dans le site et en SQL dans les fonctions Supabase, avec 39 endroits « doit rester identique à public.… ». Chaque évolution risque de désynchroniser les deux, et la logique serveur en SQL devient difficile à maintenir.

## Décision
Une API Node/TypeScript (Hono, pg, jose) sur un VPS, découpée contrôleur → service → dépôt, avec une connexion directe à la base Postgres de Supabase et de vraies transactions. Supabase garde la connexion (Auth) et le temps réel. Les règles partagées entre site et serveur vont dans `shared/`. Le site reste sur GitHub Pages et bascule sur l'API quand `VITE_API_URL` est défini.

Migration domaine par domaine : appartement d'abord, puis points et caisses, jeux solo, tower defense. Une fois un domaine en ligne, les anciennes fonctions SQL ne sont plus appelables par les joueurs.

## Options écartées
- Tout garder en fonctions SQL : la duplication TS / SQL continue de grossir.
- Edge Functions Supabase pour tout : pas de vraies transactions sur plusieurs requêtes, et on reste dépendant de la plateforme.

## Conséquences
- Un serveur à héberger, surveiller et déployer (secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`).
- La branche `backend` (worktree `../Multiplay-backend`) ne se fusionne dans `main` qu'après la mise en ligne du VPS : sinon le site appellerait une API absente.
- Tests du serveur : `npm run test:server` (PGlite), sur la branche `backend`.
