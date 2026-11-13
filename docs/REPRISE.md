# Reprendre travail_dur (Multiplay)

État vérifié le 2026-11-10 sur `main` à `27a7d12` ; mis à jour le 2026-11-13 (migrations, tests, CI, nettoyage des worktrees, ADR, documentation corrigée). Ce document sert à reprendre le projet proprement avec la méthodologie des plugins `socle` et `backend` (marketplace `equipe`). Il ne remplace pas les documents de référence, il les relie et dit ce qui est à jour, ce qui ne l'est plus et par quoi commencer.

| Document | Rôle | État |
|---|---|---|
| [CLAUDE.md](../CLAUDE.md) | Règles pour toutes les sessions et tous les agents | À jour (liste des worktrees corrigée le 2026-11-13) |
| [README.md](../README.md) | Descriptif fonctionnel, configuration Supabase, liste des migrations | À jour |
| [Plan.md](../Plan.md) | Architecture et invariants | À jour (invariants, fonctions Edge et « Vérification avant livraison » corrigés le 2026-11-13) |
| [AUDIT.md](../AUDIT.md) | Audit d'octobre et tâches P0 à P4 | À jour (RLS cochée, sauvegarde décochée le 2026-11-13) ; le reste est valable |
| [docs/adr/](adr/) | Décisions structurantes | 0001 (backend sur VPS) et 0002 à 0007, décisions déjà prises consignées après coup |
| [docs/specs/](specs/) | Specs de fonctionnalités | Trois : annonce, connexions, lien Pocharlume (livrée) ; Plinko ; Plinko en rafale |

---

## 1. Le projet en bref

Plateforme de mini-jeux jouables au clavier (et au tactile), en solo ou en ligne, déguisée en appli de notes (touche panique). Points gagnés en jouant, casino, boutique de cosmétiques, appartement à décorer, amis, classements.

- **Site** : Vite + TypeScript sans framework, hébergé sur GitHub Pages : https://fuforudude.github.io/travail_dur/ (répond, version en ligne `27a7d12` = `main`).
- **Serveur** : Supabase (Auth, Postgres avec RLS, Realtime, Edge Functions). Le serveur fait autorité : chaque score classé, point, achat, tirage et coup en ligne est validé par une fonction SQL `security definer` ou une fonction Edge. Les clients n'ont que la lecture.
- **Dépôt** : `github.com/fuforudude/travail_dur` (public).
- **Taille** : environ 20 000 lignes de TypeScript, 29 écrans dans `src/ui/`, 13 jeux, 46 migrations (0001 à 0053, numéros 0023 à 0029 non utilisés), 2 fonctions Edge.

**Jeux** : 2048, Tetris, Flappy, Wordle, tower defense (campagne de 70 niveaux en 2 chapitres, défis Héroïque et Fer, mode infini classé), Morpion, Puissance 4, Quarto, Corridor (Quoridor), Dames, Échecs, Échecs à 4, Corridor à 4 (course à la case centrale).

**Autour des jeux** : comptes invités puis email, double authentification des admins, points (gains × 3, dons entre amis, paliers), roulette et machine à sous (jeton « All in », regarder un ami jouer), boutique jusqu'au milliard, caisses (dont rareté Divin), appartement 3D (pièces, meubles, revenus automatiques, réserve en piles), amis et joueurs en ligne, administration (points, malédiction, suspension, photos, annonce, heures de connexion), version mobile (PWA, contrôles tactiles).

---

## 2. Ce qui tourne, vérifié

| Élément | État au 2026-11-10 | Comment c'est vérifié |
|---|---|---|
| Site en production | OK, version `27a7d12` | `version.json` du site en ligne |
| CI « Tests » (chaque push) | OK sur `27a7d12` | API GitHub Actions |
| CI « Supabase » (push sur `main` touchant `supabase/`) | OK : migrations jusqu'à 0051 appliquées au 2026-11-10 (0052 et 0053, Plinko, sont arrivées depuis : état de leur application non revérifié), fonctions `td` et `board4` redéployées | API GitHub Actions |
| CI « Déploiement GitHub Pages » | OK | API GitHub Actions |
| **Sauvegarde nocturne de la base** | **En échec chaque nuit depuis le 22 octobre (20 sur 20) : aucune sauvegarde n'a jamais été faite** | Étape « Phrase secrète présente ? » en échec : le secret `BACKUP_PASSPHRASE` n'existe pas |
| Tests SQL (`npm run test:sql`) | OK | Lancés en local et en CI |

**À faire en premier** : ajouter le secret `BACKUP_PASSPHRASE` (Settings → Secrets and variables → Actions du dépôt), puis lancer le workflow « Sauvegarde de la base » à la main (onglet Actions → Run workflow) et vérifier qu'un artefact `sauvegarde-N` apparaît. Garder la phrase secrète hors du dépôt : sans elle, la sauvegarde est illisible.

---

## 3. Architecture et invariants (résumé)

Le détail est dans [Plan.md](../Plan.md) et [CLAUDE.md](../CLAUDE.md). À ne jamais casser :

1. **Le serveur fait autorité.** Toute écriture passe par une fonction SQL `security definer` ou une fonction Edge ; les tables ne sont qu'en lecture (RLS). Une nouvelle fonction appelable par les joueurs doit être ajoutée volontairement à `supabase/tests/public-functions.txt` (`npm run test:sql -- --update`), sinon les tests échouent : c'est voulu.
2. **Moteurs partagés site / serveur.** Le moteur du tower defense (`src/games/towerdefense/engine/`) et celui des jeux à 4 (`src/games/four/engine/`) sont copiés dans les fonctions Edge par `npm run td:sync` (fait aussi par `npm run build`). On ne modifie jamais les copies dans `supabase/functions/`. La CI vérifie que la copie est à jour.
3. **Règles dupliquées TS / SQL.** Une quarantaine d'endroits « doit rester identique à public.… » (jeux de plateau et `match_play`, prix, raretés, revenus de l'appart…). C'est la dette que l'ADR 0001 veut résorber.
4. **Migrations.** `supabase/migrations/NNNN_<slug>.sql`, jamais réécrites une fois appliquées. Prochain numéro libre : **0054** (0052 `plinko` et 0053 `plinko_rafale` sont sur `main` ; revérifier sur les branches `agents/*` en cours, notamment `agents/monetisation` et les branches plinko, avant d'en créer une). Le workflow applique avec `--include-all`, donc un numéro plus petit qu'une migration déjà passée est accepté, mais à éviter.
5. **CSP stricte** (balise meta, ajoutée au build seulement) : pas de `style="…"` écrit dans le HTML ni d'attribut `style` posé par `setAttribute` ; passer par `element.style.x = …` ou `style.setProperty`. Scripts et styles externes interdits. Les tests en dev ne montrent pas ces erreurs : vérifier avec `npm run build` puis `npx vite preview`.
6. **Touche panique = Échap** (et bouton dédié sur téléphone). Ne jamais utiliser Échap pour fermer une fenêtre : c'est Retour arrière. L'écran panique est à `z-index: 100`, tout le reste en dessous.
7. **Secrets.** `.env.local` (dossier principal) contient `SUPABASE_ACCESS_TOKEN` : ne jamais l'afficher ; seuls les noms de variables se lisent. Les secrets de CI sont dans GitHub.

---

## 4. Branches et worktrees

Nettoyage fait le 2026-11-13 : les worktrees et branches fusionnés ont été supprimés. État vérifié avec `git worktree list` ce jour-là :

| Branche / worktree | État | Recommandation |
|---|---|---|
| `main` (dossier `Multiplay`) | Référence | — |
| `backend` (`../Multiplay-backend`) | 1 commit absent de `main` (`b32aabd`, API de l'appart), en retard sur `main` | À garder (voir § 5) ; à remettre à jour depuis `main` avant toute reprise : conflits probables dans `src/net/apartment.ts`, `src/net/furniture.ts`, `src/ui/apartment.ts` |
| Worktrees `.claude/worktrees/agent-*` (un par agent), dont ceux des branches `agents/plinko10-serveur`, `agents/plinko10-site`, `agents/plinko10-fin`, `agents/rafale-corr-site`, `agents/plinko-corrections`, `agents/plinko-bilan2`, `agents/monetisation` | Non fusionnés (travail Plinko et monétisation en cours ou à trier) ; certains sont verrouillés (`locked`) | Les garder tant que leur travail n'est pas fusionné ou abandonné, puis les supprimer (`git status` avant) |
| `.claude/worktrees/merge-tout` (branche `agents/plinko-bilan`) | Non fusionné | Idem |
| 23 branches locales `worktree-agent-*` | Restes de worktrees d'agents supprimés | À supprimer |
| Branches distantes `origin/appart`, `origin/mobile`, `origin/perf-rls`, `origin/td-sauvegarde` | Fusionnées dans `main` | À supprimer sur GitHub |
| Nombreuses branches distantes `origin/agents/*` (plinko, rafale, workflow-include-all, cli-supabase-2…) | Branches d'agents poussées, certaines déjà fusionnées | À trier : supprimer celles qui sont fusionnées |

Avant de supprimer un worktree, lancer `git status` dedans. Pour la suppression, suivre la mémoire « Jonction node_modules des worktrees » : retirer la jonction `node_modules` avant `git worktree remove`, jamais `--force`. Je n'ai pas vérifié branche par branche lesquelles des `origin/agents/*` sont fusionnées.

---

## 5. Le chantier backend sur VPS (ADR 0001)

- **Décision** (21 octobre) : une API Node/TypeScript (Hono, pg, jose) sur le VPS, en couches contrôleur → service → dépôt, connectée directement au Postgres de Supabase ; Supabase garde Auth et Realtime ; règles partagées dans `shared/`. Migration domaine par domaine : appart, puis points et caisses, jeux solo, tower defense.
- **Fait** : le domaine appart sur la branche `backend` (`server/`, `shared/furniture.ts`, tests `npm run test:server` avec PGlite, fichiers de déploiement Caddy et systemd).
- **Pas fait** : la mise en ligne. Le VPS OVH existe et sert déjà Pocharlume, mais l'API de Multiplay n'y est pas déployée. Variable `VITE_API_URL` et secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` à créer.
- **Règle** : ne pas fusionner `backend` tant que l'API ne répond pas en production, sinon le site appellerait une API absente.
- **Écart déjà connu** : depuis l'ADR, le VPS a été organisé autrement (scripts versionnés dans `Pocharlume/infra/vps/`, Let's Encrypt par nginx, déploiement par l'utilisateur `deploy` bridé). Les fichiers Caddy de la branche `backend` ne collent plus à ce choix : à trancher avant le déploiement, avec un nouvel ADR si on change d'outil.

C'est la prochaine **fonctionnalité** à mener avec le flux complet (§ 7) : il y a de vraies décisions techniques à prendre (reverse proxy, domaine de l'API, déploiement, bascule et retour arrière, retrait des anciennes fonctions SQL).

---

## 6. Écarts constatés entre les documents et la réalité

| Où | Ce qui est écrit | La réalité |
|---|---|---|
| `Plan.md`, « Vérification avant livraison » | « `package.json` ne définit pas de commande de tests » et déploiement manuel de la fonction `td` | `npm run test:sql` existe et tourne en CI ; `td` et `board4` sont redéployées par le workflow Supabase. **Corrigé le 2026-11-13** |
| `Plan.md`, « Serveur » | Une seule fonction Edge (`td`) | Deux : `td` et `board4` (jeux à 4). **Corrigé le 2026-11-13** |
| `AUDIT.md`, P1 | « Politiques RLS en `(select auth.uid())` » non coché | Fait par `0044_conseiller_supabase.sql` (branche `perf-rls`, fusionnée). **Corrigé le 2026-11-13** |
| `AUDIT.md`, P0 | « Sauvegardes de la base » coché | Le workflow existe, mais n'a jamais réussi (secret manquant, § 2). **Corrigé le 2026-11-13** : case décochée |
| `CLAUDE.md`, « Git et déploiement » (corrigé le 2026-11-13) | Liste de 5 worktrees en parallèle | Toutes ces branches sont fusionnées sauf `backend` (§ 4) |
| `README.md`, liste des migrations | `0037_securite.sql` citée en dernier | Simple ordre d'écriture ; le workflow applique tout dans l'ordre des numéros. **Corrigé le 2026-11-13** : liste complétée jusqu'à 0053 |
| `.github/workflows/supabase.yml` | `--include-all --include-all` | Drapeau en double, sans effet. **Corrigé** (commit `9460c20`, 2026-11-13) |
| Mémoire « Worktrees en parallèle » | Worktrees appart, mobile, td, perf en cours | Tous fusionnés |

Ces corrections sont des petites tâches de documentation, sans risque (aucune ne touche `supabase/migrations/`).

---

## 7. Travailler avec la méthodologie des plugins

### Les modes
Le mode se choisit à la création de chaque conversation (ou avec `/mode`) :
- **Projet dev** : la session principale est le chef de projet. Elle n'écrit pas le code elle-même : elle mène l'entretien, fait prendre les décisions techniques (skill `socle:decision-technique`), écrit la spec, puis lance les agents en arrière-plan et suit leur avancement dans le panneau « Agents » (`/suivi`).
- **Création d'assets** : le chef de projet pilote les créateurs 2D et 3D (assets suivis dans `.claude/assets.json`).
- **Simple** : Claude Code sans le plugin, pour une question ou une retouche isolée.

Pour démarrer une fonctionnalité depuis n'importe quel mode : `/feature <description>`.

### Le circuit selon la taille de la demande

| Demande | Circuit |
|---|---|
| Question, état du projet | Réponse directe |
| Petite correction (une cause claire, quelques lignes) | Un agent `dev`, puis `reviewer`. Pas de spec. `securite-backend` en plus si ça touche une migration, l'autorisation ou des données |
| Petite fonctionnalité | Entretien court, spec de quelques lignes validée, un ou deux `dev`, puis `reviewer` et `qa` en même temps |
| Fonctionnalité, refonte (ex. : backend sur VPS) | Flux complet : entretien (`socle:mener-entretien`), décisions techniques, spec (`socle:rediger-spec`), validation de la spec (porte humaine n° 1), vagues de `dev` en parallèle, contrôles (`reviewer`, `qa`, plus `architecte` et `securite-backend` pour le backend), livraison, ADR (`socle:ecrire-adr`), bilan |

### Les agents
- `dev` : code et tests d'une tâche précise, dans son propre worktree, puis commit sur sa branche.
- `reviewer` : bugs, cas non gérés, écarts à la spec. Après toute modification, avant commit.
- `qa` : vérifie chaque critère d'acceptation en lançant les tests et l'application.
- `redacteur` : documents tirés du code réel (guide du code, architecture, README).
- `architecte` (plugin `backend`) : règles de couches et d'architecture, sur le plan puis sur chaque changement backend.
- `securite-backend` (plugin `backend`) : dès qu'un changement touche une route, un service, une migration, l'authentification ou des données sensibles.

### Ce qui est propre à ce projet
- **Pas de CI de fusion** : on pousse directement sur `main` (autorisé par `.claude/agents-equipe.json`, `pushBrancheProtegeeAutorise: true`). Les garde-fous demandent l'accord de l'utilisateur pour tout push qui touche `supabase/migrations/` ou `supabase/functions/`, puisqu'un push sur `main` les applique en production.
- **Vérification complète** avant tout push : `npm run build` (synchronisation des moteurs, `tsc`, build Vite) puis `npm run test:sql`. Il n'y a pas de `npm run verifier` ni de lint. `npm run test:site` (`node --test "src/**/*.test.mjs"`) lance les tests des fonctions pures du site (Plinko : seau à jetons et file d'envoi) ; la CI l'exécute, avec Node 24 (`.github/workflows/tests.yml`).
- **Pour une interface**, vérifier aussi sur le build de production (`npm run build`, puis `npx vite preview`), à cause de la CSP (§ 3, point 5).
- **Commits** en français, au nom de l'utilisateur (`titouan`), sans ligne `Co-Authored-By` (consigne globale).
- **Suivi** : tenir les tâches du projet « Multiplay » dans l'outil taches (taches.pocharlume.fr) : reprendre ou créer la tâche au début, la terminer une fois vérifiée, créer les suites en « à faire ».
- **Le site historique garde sa logique en SQL** : c'est l'écart assumé aux règles `architecture-backend`, prévu par l'ADR 0001. Tout **nouveau** code backend (branche `backend`) suit ces règles à la lettre.

### Ce qui manque pour profiter pleinement des plugins
- `.claude/settings.json` (permissions communes des agents) : absent, seul `settings.local.json` existe. À créer avec la skill `socle:setup-projet` (modèle `modeles/settings.json`).
- ADR des décisions déjà prises mais jamais consignées, à écrire avec `socle:ecrire-adr` :
  1. Le serveur fait autorité : fonctions SQL `security definer`, clients en lecture seule.
  2. Moteurs partagés site / fonctions Edge, copiés par `td:sync`.
  3. Numérotation des migrations par domaine et application automatique (`db push --include-all`).
  4. Hébergement sur GitHub Pages avec CSP en balise meta.
  5. Touche panique sur Échap, Retour arrière pour fermer.
  6. Économie : gains × 3, pas d'achat de points contre de l'argent réel (raison légale, `AUDIT.md` P3).
- Une commande de vérification unique (`npm run verifier` : build, `test:sql`, plus tard lint) : préalable à la skill `socle:outiller-ci` (revue automatique et fusion des PR par la CI). C'est une décision à prendre : passer aux PR fusionnées par la CI, ou garder le push direct.

---

## 8. Par où reprendre, dans l'ordre

1. **Sauvegardes** (urgent, action de l'utilisateur) : secret `BACKUP_PASSPHRASE`, puis un lancement manuel du workflow pour vérifier.
2. **Photos des cadres listables par tous** (`AUDIT.md`, P0, toujours ouvert) : bucket `artworks` privé et liens signés pour les photos possédées. Petite fonctionnalité avec migration : `dev`, puis `reviewer` et `securite-backend`.
3. **Ménage** : fait en grande partie le 2026-11-13 ; reste le tri décrit au § 4 (branches locales `worktree-agent-*`, branches distantes, worktrees Plinko et monétisation).
4. **Documentation** : faite sur la branche `agents/doc-reprise` (écarts du § 6 corrigés, ADR 0002 à 0007 écrits, `.claude/settings.json` créé), en attente de fusion. Reste la décision sur `npm run verifier` et la CI de fusion (§ 7).
5. **Backend sur VPS** : remettre `backend` à jour depuis `main`, puis flux complet (`/feature`) pour la mise en ligne de l'API de l'appart.
6. **Suite de l'audit** : P1 (hébergement, ménage automatique `pg_cron`, photos compressées), puis P2 (défis du jour, replays, saisons…), P3 et P4 avant toute monétisation.

---

## 9. Pièges déjà rencontrés

- **Session dans un worktree** : les commandes git complexes (boucles, `-C` vers un autre dossier) sont refusées par l'isolation ; lancer des commandes git simples, une par une. Pousser avec `git push origin HEAD:main` uniquement quand le push direct sur `main` est prévu.
- **Rebase avec des commits de fusion** : échoue ; faire `git fetch`, vérifier que `main` n'a pas bougé (`git merge-base --is-ancestor origin/main HEAD`), puis pousser.
- **Fin de ligne** : `public-functions.txt` peut passer en CRLF sous Windows ; le script de tests lit les deux.
- **Navigateur de test** : Edge piloté par playwright-core ne démarre plus sur le PC (depuis fin octobre) ; utiliser le navigateur intégré de l'application Claude pour regarder le site.
- **Build local sans Supabase** : un worktree sans `.env.local` construit le site en « mode local » (sans serveur) ; les fonctions en ligne n'y apparaissent pas.
- **Tower defense** : un niveau réussi n'est enregistré que via la file d'envoi (`uploads.ts`) et les tickets réservés d'avance ; la fonction `td` rejoue chaque vague avec le moteur partagé. Changer le moteur sans redéployer `td` invalide les parties (le workflow le fait automatiquement).

---

## Checklist de début de session

- [ ] Lire `CLAUDE.md`, puis ce document (§ 2 et § 8).
- [ ] `git fetch` et `git worktree list` : sur quelle branche suis-je, `main` a-t-il bougé ?
- [ ] Dernier numéro de migration sur `origin/main` et sur `backend` avant d'en créer une.
- [ ] Reprendre ou créer la tâche dans l'outil taches (projet « Multiplay »).
- [ ] Choisir le circuit selon la taille de la demande (§ 7).
- [ ] Avant de pousser : `npm run build` et `npm run test:sql` verts ; accord de l'utilisateur si `supabase/migrations/` ou `supabase/functions/` sont touchés.
