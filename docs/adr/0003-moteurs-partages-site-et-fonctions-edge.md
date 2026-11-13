# 0003. Moteurs de jeu partagés entre le site et les fonctions Edge, copiés par `td:sync`

Date : 2026-10-20 (tower defense), étendu le 2026-10-21 (jeux à 4) ; consignée après coup
Statut : acceptée

## Contexte
Le serveur doit valider un tower defense en rejouant les vagues, et les coups des jeux à 4 (échecs à 4, corridor à 4), avec exactement les mêmes règles que le site (commentaire de `scripts/td-sync.mjs` : « pour que le serveur valide avec exactement le même code que le site »). Le reste du raisonnement est déduit, non écrit à l'époque : réécrire ces moteurs en SQL doublerait un code long et évolutif, et les écrire deux fois en TypeScript risquerait des divergences qui invalideraient des parties légitimes.

## Décision
Le moteur vit une seule fois, dans le site : `src/games/towerdefense/engine/` et `src/games/four/engine/`. Le script `scripts/td-sync.mjs` en copie les fichiers `.ts` dans `supabase/functions/td/engine/` et `supabase/functions/board4/engine/`, avec un en-tête « ne pas modifier ici ». On modifie uniquement la source.
- La copie est lancée par `npm run td:sync` et par `npm run build`.
- La CI refuse un push dont la copie est périmée (`.github/workflows/tests.yml` : `npm run td:sync && git diff --exit-code supabase/functions`).
- Un push sur `main` touchant un moteur ou `supabase/` redéploie `td` et `board4` (`.github/workflows/supabase.yml`), pour qu'un moteur modifié n'invalide pas les parties en cours.

## Options écartées
- Réécrire les règles en SQL : raison non consignée à l'époque (la duplication TS/SQL existe pourtant ailleurs, voir ADR 0002). Éviter une deuxième copie à maintenir est une raison déduite, non écrite.
- Dossier partagé importé directement par les fonctions Edge : raison non consignée ; la copie est le choix visible dans le code.

## Conséquences
- Une seule vérité pour les règles de ces jeux ; le serveur valide avec le code du client.
- Les copies sont versionnées dans git : un diff dans `supabase/functions/*/engine/` est normal après une modification du moteur, jamais une modification à la main.
- Changer le moteur sans redéployer la fonction invalide les parties ; le workflow le fait automatiquement, un déploiement manuel doit penser à `td:sync`.
- Le script ne réécrit pas un fichier identique, pour éviter des faux diffs de fins de ligne sous Windows (`scripts/td-sync.mjs`).
