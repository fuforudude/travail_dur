# 0002. Le serveur fait autorité : les clients lisent, des fonctions SQL écrivent

Date : 2026-10-19 (décision prise à la création de `0001_init.sql`, consignée après coup)
Statut : acceptée

## Contexte
Le site est une application statique (GitHub Pages) dont le code est public et modifiable par n'importe quel joueur dans son navigateur. Scores classés, points, achats, tirages du casino et coups en ligne ne peuvent donc pas être crus sur parole : sans serveur qui décide, tout classement et toute économie sont falsifiables.

## Décision
- Les rôles `anon` et `authenticated` n'ont que le droit de lire les tables (`revoke all` puis `grant select`, avec une politique RLS de lecture) : par exemple `supabase/migrations/0001_init.sql:28-29` et `supabase/migrations/0007_points_casino.sql:44-47`.
- Toute écriture passe par une fonction Postgres `security definer` avec `set search_path = ''`, qui identifie le joueur par `auth.uid()` et valide tout (en-tête de `0001_init.sql:1-5`). Le client n'envoie jamais un résultat à croire : par exemple `points_add` applique elle-même le multiplicateur de gains (`0034_gains.sql`).
- Quand la validation demande de rejouer une partie avec le code du jeu, c'est une fonction Edge qui le fait (voir ADR 0003).
- Garde-fou automatique : `npm run test:sql` (`scripts/sql-test.mjs`) rejoue les migrations dans PGlite et compare la liste des fonctions appelables par les joueurs à `supabase/tests/public-functions.txt`. Une fonction publique de plus fait échouer le test tant qu'on ne l'a pas ajoutée volontairement (`npm run test:sql -- --update`, puis relire le diff).

## Options écartées
- Faire confiance au client, avec des vérifications de vraisemblance : raison non consignée à l'époque ; la phrase de `0001_init.sql` pose seulement le principe.
- Écritures directes avec des politiques RLS fines : raison non consignée à l'époque.

## Conséquences
- Les scores, points, achats et coups ne sont pas truquables depuis le navigateur ; les droits sont testés en CI.
- La logique métier vit en SQL, donc dupliquée avec les règles TypeScript du site (affichage, jeux solo, prix) : ces endroits sont marqués « doit rester identique à public.… ». C'est la dette que l'ADR 0001 veut résorber par une API Node.
- Exception connue : les parties solo contre l'ordinateur ne sont pas vérifiées par le serveur, seulement limitées en fréquence et par jour (`0034_gains.sql`, `points_solo`).
- Tout nouveau code backend (branche `backend`) suit les règles d'architecture en couches, pas ce modèle SQL.
