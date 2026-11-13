# 0004. Migrations numérotées par domaine et appliquées automatiquement avec `--include-all`

Date : 2026-10-21 ; consignée après coup
Statut : acceptée

## Contexte
Plusieurs sessions travaillaient en parallèle dans des worktrees, chacune créant ses migrations (appartement, jeux, amis, mobile…). Deux migrations pouvaient prendre le même numéro, ou une migration plus ancienne arriver après une plus récente. Les migrations étaient jusque-là collées à la main dans l'éditeur SQL de Supabase.

## Décision
- Fichiers `supabase/migrations/NNNN_<slug>.sql`, jamais réécrits une fois appliqués ; avant d'en créer une, on vérifie le dernier numéro sur `origin/main` et sur les branches des worktrees (`CLAUDE.md`).
- Des plages ont été réservées par domaine : 0013 à 0029 pour l'appartement, 0030 et plus pour les jeux (`README.md`, section Supabase). Les numéros 0023 à 0029 n'ont finalement jamais été utilisés ; depuis, les numéros suivent simplement l'ordre d'arrivée.
- Application automatique : `.github/workflows/supabase.yml`, à chaque push sur `main` touchant `supabase/`, lance `npm run test:sql`, puis `supabase db push --linked --include-all`. `--include-all` fait accepter une migration de numéro inférieur à une autre déjà appliquée ; sans lui, `db push` la refuse (commentaire du workflow, introduit par le commit `01e5573`).

## Options écartées
- Coller les migrations à la main dans l'éditeur SQL : méthode d'origine, remplacée par l'automatisation (commit `3a1c0ee`, « Supabase automatique »).
- Une numérotation strictement linéaire sans plages : raison non consignée ; les plages visaient à éviter les collisions entre sessions parallèles.

## Conséquences
- Plus de copier-coller, et les migrations ne partent en production que si les tests SQL passent.
- Un push sur `main` qui touche `supabase/migrations/` modifie la production de façon irréversible : l'accord de l'utilisateur est exigé (`.claude/agents-equipe.json`, `cheminsProd`).
- Avec `--include-all`, un mauvais numéro n'est pas détecté : la vérification des numéros reste manuelle.
- Une erreur se corrige par une nouvelle migration, jamais en réécrivant une ancienne.
