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
  les fonctions SQL d’autorité. La fonction Edge Tower Defense est dans `supabase/functions/td/`.

## Invariants à préserver

- Le navigateur ne décide jamais des scores classés, des points, des achats, des coups en ligne ou de
  la progression de compte : les données sensibles sont vérifiées et enregistrées côté serveur.
- Les règles des jeux en ligne existent parfois en double, en TypeScript et en SQL. En particulier,
  les jeux de plateau côté client doivent rester cohérents avec `match_play` dans
  `supabase/migrations/0006_plateaux.sql`.
- Le moteur Tower Defense est une exception au code dupliqué : le serveur embarque une copie générée
  du moteur navigateur. Modifier `src/games/towerdefense/engine/`, puis exécuter
  `npm run td:sync` (également fait par `npm run build`). Ne pas modifier directement la copie dans
  `supabase/functions/td/engine/`.
- Une migration déjà appliquée en production ne se réécrit pas : toute évolution de schéma ou de
  fonction SQL passe par un nouveau fichier numéroté dans `supabase/migrations/`. Le README détaille
  l’ordre d’application et les opérations de déploiement.
- Les sauvegardes locales servent au confort/hors-ligne, pas de preuve au serveur. Toujours vérifier
  les entrées du client avant de s’en servir pour une décision de compte.

## Vérification avant livraison

- `npm run build` synchronise le moteur Tower Defense, vérifie les types TypeScript puis construit le
  site dans `dist/`.
- `package.json` ne définit actuellement pas de commande de tests automatisés ; compléter le build
  par des tests manuels des parcours touchés, notamment les modes hors ligne et Supabase concernés.
- Après une modification du moteur ou de la fonction Tower Defense, vérifier également que la
  fonction Edge déployée correspond au moteur synchronisé (`npm run td:sync`, puis déploiement
  `supabase functions deploy td`, voir le README).
