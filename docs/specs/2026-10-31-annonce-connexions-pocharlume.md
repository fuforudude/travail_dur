# Annonce, heures de connexion et lien Pocharlume

Statut : livrée
Date : 2026-10-31

## Besoin
Les admins veulent prévenir tous les joueurs d'une nouveauté ou d'une maintenance, savoir quand chaque compte se connecte, et faire découvrir le nouveau jeu pocharlume.fr.

## Périmètre
- Dedans :
  - une annonce unique, écrite par un admin, affichée à tous dans un bandeau tout en haut, par-dessus le site, qu'on ferme avec une croix ;
  - un journal des connexions de chaque compte (arrivée et dernière activité), lisible par les admins dans la page Administration ;
  - un lien texte « Pocharlume » dans la barre du haut, sur toutes les pages.
- Hors périmètre : plusieurs annonces à la fois, annonce programmée, annonce ciblée sur certains joueurs, statistiques de fréquentation globales.

## Critères d'acceptation
- [ ] Un admin écrit un texte dans « Annonce » et le publie : tout visiteur (connecté ou non) voit ce texte dans un bandeau en haut de l'écran au plus tard 5 minutes après, ou au prochain chargement.
- [ ] La croix du bandeau le ferme ; il ne revient pas au rechargement tant que l'annonce ne change pas ; une nouvelle annonce publiée le fait réapparaître.
- [ ] « Retirer l'annonce » fait disparaître le bandeau chez tout le monde (au prochain rafraîchissement).
- [ ] Un non-admin (ou un admin sans double authentification) ne peut pas modifier l'annonce : le serveur refuse.
- [ ] Le bandeau passe sous l'écran de la touche panique.
- [ ] Chaque compte qui ouvre le site enregistre une séance ; tant que le site reste ouvert, la fin de séance avance (toutes les 5 minutes) ; après plus de 15 minutes sans activité, une nouvelle séance commence.
- [ ] Dans Administration, la liste des joueurs montre la dernière connexion de chacun ; la fiche d'un joueur liste ses 30 dernières séances (date, heure d'arrivée, heure de fin, durée).
- [ ] Un joueur ne lit jamais les séances des autres (ni les siennes) : seule la lecture admin est permise.
- [ ] Les séances de plus de 90 jours sont effacées.
- [ ] La barre du haut affiche un lien « Pocharlume ↗ » qui ouvre https://pocharlume.fr dans un nouvel onglet.
- [ ] Chaque publication ou retrait d'annonce apparaît dans le journal des admins.

## Tâches
1. Migration `0050_annonce_connexions.sql` : table `announcement` (une ligne), fonction `admin_announce`, table `connections`, fonctions `connection_ping` et `admin_last_seen`, droits et RLS ; tests SQL.
2. Bandeau d'annonce (`src/core/announcement.ts`) branché au démarrage, et section « Annonce » de la page Administration.
3. Signe de vie de connexion au démarrage du compte (`src/net/connections.ts`), dernière connexion dans la liste des joueurs et séances dans la fiche.
4. Lien Pocharlume dans la barre du haut (`src/ui/layout.ts`), styles, README.

## Impacts
- Données / migrations : `0050_annonce_connexions.sql` (2 tables, 3 fonctions joueurs/admins).
- API : `rpc admin_announce(body)`, `rpc connection_ping()`, `rpc admin_last_seen(ids)` ; lecture directe de `announcement` (tous) et `connections` (admins).
- Écrans : bandeau global, barre du haut, page Administration.

## Questions ouvertes
- Aucune.
