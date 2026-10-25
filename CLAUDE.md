# travail_dur (Multiplay)

Plateforme de mini-jeux jouables au clavier, en solo ou en ligne, avec points, casino, boutique et appartement. Site sur GitHub Pages, données et règles serveur sur Supabase.

## Commandes
- Lancer : `npm run dev`
- Compiler : `npm run build` (synchronise d'abord le moteur du tower defense, puis `tsc` et `vite build`)
- Tester la base : `npm run test:sql` (rejoue toutes les migrations dans PGlite et vérifie droits et règles de sécurité)
- Vérifier les types seuls : `npx tsc`

## Architecture
Voir [Plan.md](Plan.md) : architecture, invariants à préserver et repères de maintenance. Le descriptif fonctionnel est dans [README.md](README.md), l'audit dans [AUDIT.md](AUDIT.md). Les décisions structurantes sont dans `docs/adr/`, les specs dans `docs/specs/`.

En bref :
- `src/ui/` les écrans, `src/core/` les services navigateur, `src/games/` un dossier par jeu (contrat `Game`, enregistré dans `registry.ts`), `src/net/` les appels Supabase.
- Le serveur fait autorité : scores, points, achats, tirages et coups en ligne sont validés par des fonctions SQL `security definer`. Les clients n'ont que la lecture.
- Le moteur du tower defense est copié dans `supabase/functions/td/engine/` par `npm run td:sync` : modifier seulement `src/games/towerdefense/engine/`.

## Conventions
- Tout en français : interface, commentaires, noms de migrations, messages de commit.
- TypeScript sans framework UI.
- Migrations : `supabase/migrations/NNNN_<slug>.sql`. Avant d'en créer une, vérifier le dernier numéro sur `origin/main` **et** sur les branches des worktrees en cours (`git worktree list`). Une migration appliquée ne se réécrit jamais.
- Une règle dupliquée entre TypeScript et SQL doit rester identique des deux côtés.

## Git et déploiement
- Un push sur `main` déploie le site (GitHub Pages) et, s'il touche `supabase/`, **applique les migrations en production** après `npm run test:sql`.
- En fin de session de dev, une fois build et tests passés : commit puis `git pull --rebase` et push sur `main`, sans redemander. Ne jamais pousser un état qui ne compile pas ou dont les tests échouent.
- Plusieurs sessions travaillent en parallèle dans des worktrees (`../Multiplay-appart`, `../Multiplay-backend`, `../Multiplay-mobile`, `../Multiplay-td`, `../Multiplay-perf`). Dans un worktree, pousser sur sa branche, jamais sur `main`.
- La branche `backend` ne se fusionne pas tant que l'API n'est pas en ligne sur le VPS (voir `docs/adr/0001-backend-sur-vps.md`).

## Agents de l'équipe
Ce projet utilise les plugins `socle` et `backend` du marketplace `equipe` (github.com/fuforudude/agents-equipe) :
- Le chef de projet tient la session : entretien, spec validée, puis agents `dev`, `reviewer`, `architecte`, `securite-backend`, `qa`.
- Toute nouvelle fonctionnalité a une spec dans `docs/specs/`, toute décision structurante un ADR dans `docs/adr/`.
- Exception assumée au flux par PR : ce projet n'a pas de CI de fusion, on pousse directement sur `main` (`.claude/agents-equipe.json` l'autorise). Les garde-fous demandent l'accord de l'utilisateur pour tout push qui touche `supabase/migrations/` ou `supabase/functions/`, puisqu'il part en production.
- Le site historique garde sa logique métier en SQL (fonctions `security definer`) : c'est l'écart aux règles `architecture-backend` que l'ADR 0001 prévoit de résorber. Le nouveau code backend (branche `backend`) suit les règles à la lettre.
