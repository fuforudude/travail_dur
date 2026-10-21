# Audit de l'application (octobre 2026)

Récapitulatif de l'audit : sécurité, performance, hébergement, contenu et monétisation, avec les tâches dans l'ordre de priorité.
Les tarifs et quotas cités sont des ordres de grandeur, à revérifier sur les sites des fournisseurs avant de décider.

## Ce qui est déjà solide

- **Le serveur fait autorité sur tout.** 2048, Tetris, Flappy et le tower defense sont rejoués côté serveur, et le serveur valide les coups des jeux de plateau.
- **Les clients n'ont que la lecture** sur les tables (RLS). Toutes les écritures passent par des fonctions `security definer`.
- **Les tirages sont faits par le serveur**, pour le casino comme pour les caisses.
- **La CSP est stricte**, le bundle reste raisonnable grâce au chargement des pages à la demande, et `npm audit` ne trouve aucune vulnérabilité.
- **Les fonctions internes** (`points_add`, `apartment_settle`…) ne sont pas appelables par les joueurs. Vérifié pour toutes les fonctions créées depuis `0013`.

---

## Tâches par ordre de priorité

### P0 : sécurité, avant toute monétisation

- [ ] **Photos listables par tous.** La politique `photos : lecture` (`0009_appart_admin.sql`) permet de lister tout le bucket `artworks`. On contourne ainsi la caisse souvenirs et le déblocage des photos.
  - Correctif : rendre le bucket privé, et ajouter une fonction qui renvoie des liens signés (temporaires) uniquement pour les photos possédées.
- [x] **Discussions de tous les salons lisibles.** *Fait (`0037_securite.sql`) : seuls les membres d'un salon lisent sa discussion ; on le rejoint en l'ouvrant (`room_join`, 20 salons par heure au plus).* La politique `messages lisibles` est en `using (true)` (`0005_chat.sql`). N'importe quel connecté lit toutes les discussions, et le code du salon ne protège rien.
  - Correctif : lire via une fonction `room_messages(code)`, ou passer la discussion en Realtime Broadcast, sans stockage.
- [x] **Double authentification (TOTP) pour les admins.** *Fait (`0037_securite.sql`, `src/net/mfa.ts`) : `admin_check()` exige `aal2` ; la page Administration fait scanner un QR code la première fois, puis demande le code.* Aujourd'hui, le compte admin n'est protégé que par un lien par email.
  - Correctif : exiger `aal2` dans `admin_check()`.
- [ ] **Sauvegardes de la base.** À ma connaissance, l'offre gratuite n'en a pas.
  - Correctif : un `pg_dump` chiffré et automatique vers un stockage privé, jamais dans le dépôt, qui est public.
- [ ] **Migrations suivies et automatiques**, au lieu du copier-coller dans l'éditeur SQL.
  - Correctif : `supabase db push` dans GitHub Actions.
- [x] **Tests SQL en CI** *Fait : `npm run test:sql` (`scripts/sql-test.mjs`, workflow `Tests`) rejoue les migrations dans PGlite, compare les fonctions appelables par les joueurs à `supabase/tests/public-functions.txt` et teste la discussion, la suppression de compte, la double authentification. Il a trouvé l'ancien tower defense SQL (`td_start`, `td_wave`) encore appelable : fermé dans `0037`.*, avec PGlite comme pour les migrations de l'appart. Ils vérifient en particulier qu'aucune fonction interne n'est exécutable par `anon` ou `authenticated`.
- [x] **Suppression de compte par le joueur lui-même.** *Fait : page Compte, confirmation par le pseudo (`account_delete`, `0037_securite.sql`).* C'est une obligation RGPD.

### P1 : hébergement et performance

- [ ] **Front sur Cloudflare Pages.** C'est gratuit, l'usage commercial est autorisé (ce n'est pas le cas de GitHub Pages), et ça fonctionne avec un dépôt privé.
  - Ajouter un fichier `_headers` : CSP en vrai en-tête, `frame-ancestors 'none'`, HSTS, et cache `immutable` sur `assets/`.
- [ ] **Passer le dépôt en privé.** Il expose aujourd'hui l'anti-triche et la touche panique.
- [ ] **Un domaine à soi** (environ 10 €/an), avec SPF, DKIM et DMARC dans Brevo pour que les emails ne finissent plus en spam. Il est aussi demandé par les régies pub.
  - Attention : un domaine classé « jeux » est bloqué plus vite par les filtres des établissements. On peut garder `github.io` en miroir.
- [x] **Temps réel : supprimer l'écoute globale de la table `cosmetics`** *Fait : relue à la demande (cache d'une minute), retirée de la diffusion temps réel (`0037`).* (`src/net/cosmetics.ts`). Son coût grandit avec le carré du nombre de joueurs.
  - Correctif : passer par Broadcast depuis la base (`realtime.broadcast_changes`), ou relire à la demande.
  - Limite à garder en tête : environ 200 connexions Realtime simultanées en gratuit, soit environ 200 onglets ouverts.
- [x] **Récolte automatique de l'appart toutes les 5 minutes** *Fait.* au lieu de chaque minute (`EVERY` dans `src/net/idle.ts`). Le compteur défile déjà en local, donc ça ne se verra pas.
- [ ] **Politiques RLS en `(select auth.uid())`** au lieu de `auth.uid()`, qui est recalculé à chaque ligne.
  - Lancer aussi *Security Advisor* et *Performance Advisor* dans le tableau de bord Supabase.
- [ ] **Photos compressées avant l'envoi.** Les réduire en WebP (environ 200 ko max) dans le navigateur, côté admin, pour préserver le quota de bande passante.
- [ ] **Ménage automatique avec `pg_cron`** :
  - les parties jamais terminées ;
  - l'ancien historique de points ;
  - les comptes invités inactifs depuis 90 jours (ils comptent dans les utilisateurs actifs par mois et dans la taille de la base).
- [ ] **Supabase Pro** (environ 25 $/mois), **obligatoire avant d'encaisser de l'argent** : sauvegardes quotidiennes, pas de mise en pause, quotas bien plus larges.

### P2 : contenu et innovations

Positionnement unique par rapport à Poki, CrazyGames, les sites « unblocked » et skribbl : la discrétion, des scores vérifiés et une progression sociale (appart, amis).

- [ ] **Défis du jour** : la même graine pour tous à 2048, Tetris et Flappy, avec un classement du jour entre amis. C'est presque gratuit, le serveur tire déjà les graines.
- [ ] **Replays des records.** Le serveur garde déjà les coups, on peut donc revoir la partie record d'un ami.
- [ ] **Groupes « classe »** : un code de groupe, un classement de groupe et un appart commun.
- [ ] **Touche panique améliorée** : déguisements façon Docs ou tableur, panique automatique quand la fenêtre perd le focus, favicon synchronisée.
- [ ] **Course de frappe en salon** : jouable au clavier, et ça ressemble à du travail.
- [ ] **Saisons, succès et badges**, avec des classements saisonniers remis à zéro.
- [ ] **Appart social** : likes, livre d'or, « appart de la semaine ».
- [ ] **Publier le tower defense sur CrazyGames**, qui reverse une part de ses revenus pub.
- [ ] **Désactiver le screamer et la malédiction** pour les comptes payants, ou les retirer. Un sabotage par un admin sur un joueur qui a payé est un risque juridique, et ça fait du bruit en cours.
- ⚠️ **À éviter : les échanges de meubles entre joueurs.** Les objets deviennent revendables, ce qui ouvre la porte à la revente contre de l'argent réel et à la législation sur les jeux à objets monétisables (loi SREN).

### P3 : cadre légal, avant le premier euro

- [ ] **Statut** : une micro-entreprise (SIRET).
- [ ] **Documents** : mentions légales, CGU et CGV, politique de confidentialité.
- [ ] **Consentement** : un bandeau certifié Google, obligatoire pour la pub dans l'Espace économique européen.
- [ ] **Mineurs** :
  - consentement parental pour les données des moins de 15 ans ;
  - aucune publicité ciblée pour les mineurs (DSA).
- [ ] **Monnaie premium séparée.** Elle ne doit jamais servir au casino ni aux caisses. Les points gagnés en jouant restent l'économie gratuite.
  - Pourquoi : vendre des points qui se misent à la roulette, à la machine à sous ou dans des caisses, c'est vendre des loot boxes payantes. C'est interdit de fait en Belgique, surveillé par l'ANJ en France, et mal vu des régies.
- [ ] **Paiements via un « merchant of record »** (Lemon Squeezy ou Paddle), qui gère la TVA européenne.
  - Le webhook est vérifié par signature dans une fonction serveur.
  - L'objet n'est donné qu'une fois, grâce à une table d'achats unique par identifiant d'événement.
  - On ne se fie jamais à la page de retour du navigateur.
  - Les remboursements et les rétrofacturations retirent l'objet.
- [ ] **Captcha Turnstile** (gratuit) à la création de compte, pour limiter les comptes multiples et les scripts. Les parties solo sont crues sur parole : environ 1 800 points par jour et par compte sont faciles à obtenir par script.

### P4 : monétisation, dans cet ordre

1. [ ] **Dons** (Ko-fi). Aucun risque, à lancer en premier.
2. [ ] **Abonnement « Soutien »** (2 à 3 €/mois) : badge, un cosmétique par mois, une pièce d'appart en plus, sans pub.
3. [ ] **Cosmétiques en vente directe et pass saisonnier**, sans aucun hasard.
4. [ ] **Pub récompensée**, à l'initiative du joueur (une vidéo contre des points gratuits). C'est la seule pub compatible avec la discrétion. Les régies web (Google Ad Manager, AdinPlay) demandent un minimum de trafic.
5. [ ] **Bannières**, éventuellement : seulement sur les pages hors jeu, statiques et sans son. Avec peu de trafic, elles rapportent quelques euros pour 1 000 pages vues.

- ❌ **Pas d'achat direct de points** dans l'économie actuelle, pour la raison légale du P3.
  - De toute façon, avec les gains ×3 et les revenus de l'appart ×4, les points sont trop abondants pour valoir de l'argent.
