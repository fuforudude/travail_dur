# travail_dur

Petite plateforme de mini-jeux jouables **entièrement au clavier**, en solo ou à plusieurs (salons avec code), conçue pour rester discrète : apparence sobre, aucun son par défaut, onglet nommé « Notes » et **touche panique**.

En ligne : https://fuforudude.github.io/travail_dur/

## Jeux

| Jeu | Modes | Touches |
| --- | --- | --- |
| 2048 | solo, classé | flèches, WASD ou ZQSD · `R` recommencer |
| Tetris | solo, classé | `←` `→` déplacer · `↑` ou `X` tourner · `C` sens inverse · `↓` descendre · `Espace` lâcher · `P` pause · `R` rejouer |
| Wordle | mot du jour classé (le même pour tous), ou entraînement | lettres au clavier · `Entrée` valider · `Retour arrière` effacer · `Tab` changer de mode |
| Flappy Bird | solo, classé | `Espace` ou `↑` battre des ailes · `R` rejouer |
| Tower defense | solo : campagne de 20 niveaux avec une histoire, 5 défis bonus, étoiles et boutique à étoiles, puis mode infini classé | carte : flèches + `Entrée` jouer un niveau · `I` mode infini · `C` caisses · dialogues : `Entrée` suite, `Tab` passer · en jeu : flèches case · `1`–`0` construire · `U` améliorer (au 3e niveau, `U` puis `1` ou `2` pour choisir la voie ; sur la tour spéciale d’une carte, `U` la débloque) · `S` vendre · `Espace` lancer la vague · `F` vitesse ×1/×2/×3 · `P` pause · `R` abandonner ; on construit et on améliore aussi pendant les vagues |
| Puissance 4 | solo contre l’ordinateur, ou en ligne à 2 (classé) | `←` `→` colonne · `Entrée` / `Espace` / `↓` jouer · `R` revanche |
| Morpion | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches ou `1`–`9` case · `Entrée` jouer · `R` revanche |
| Échecs | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches case · `Entrée` choisir la pièce puis la case · promotion `D` `T` `F` `C` · `R` revanche |
| Dames (internationales, 10×10) | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches case · `Entrée` sur la pièce puis sur chaque arrêt de la rafle · `R` revanche |
| Quoridor (« corridor ») | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches case · `Entrée` avancer · `M` mode mur · `Espace` tourner le mur · `R` revanche ; à la souris, clic entre deux cases pour un mur |
| Quarto | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches · `Entrée` poser puis donner une pièce · `Tab` plateau ↔ réserve · `R` revanche |

Dans chaque jeu de plateau, `I` (ou le bouton *Règles*) affiche les règles complètes. En solo, les camps s’échangent à chaque revanche.

Partout : `↑` `↓` + `Entrée` pour naviguer, `Retour arrière` pour revenir.

## Points et casino

Chaque partie terminée rapporte des **points**, attribués par le serveur quand il enregistre la partie (le client ne peut ni choisir ni gonfler ses gains). Tous les gains de jeu et de record ci-dessous sont **multipliés par 3** (`points_gain_mult`, `0034_gains.sql`), et chaque partie terminée rapporte en plus **30 points « Partie jouée »**, même sans record (2048 et Tetris d’au moins 30 s, Flappy d’au moins 10 s, tower defense d’au moins une vague ; 40 par jour au plus). Le barème complet, multiplicateur compris, est sur la page *Points* (◆ en haut à droite) :

| Jeu | Points |
| --- | --- |
| 2048 | √score, + 30 / 150 / 400 pour les tuiles 1024 / 2048 / 4096 |
| Tetris | √score |
| Flappy Bird | tuyaux^1,5 ÷ 4 |
| Tower defense | mode infini : 2 × n pour chaque vague n terminée ; campagne : 100 + 40 × niveau pour un niveau réussi la première fois, 5 × niveau ensuite (défis bonus : niveaux 21 à 25) |
| Wordle | trouvé en n essais : 40 + 15 × (6 − n) ; raté : 5 |
| À deux | victoire : Morpion 15 · Puissance 4 30 · Quarto 40 · Quoridor 60 · Dames 90 · Échecs 100 ; nul un tiers ; défaite 3 ; abandon ou temps : moitié |
| Solo contre l’ordinateur | gagné : 10 + un dixième de la victoire à deux ; sinon 4 (une partie toutes les 20 s, 30 par jour : le résultat vient du navigateur) |
| Records | record personnel +100, record absolu (tous joueurs) +500 |

Le barème vise environ 20 à 30 points par minute de jeu, quel que soit le jeu. 100 points de bienvenue ; les parties jouées avant l’arrivée des points ont été comptées (sans les bonus de record). Anti-abus : les parties à deux trop courtes ne rapportent rien, ni au-delà de 10 parties par jour contre le même adversaire.

Les points se misent à la **roulette** (européenne : rouge, noir, vert, pair, impair, manque, passe, douzaines, numéro plein ; retour 97,3 %) et à la **machine à sous** (3 rouleaux, jusqu’à ×400 ; retour 95,9 %). Le tirage est fait par le serveur ; mise maximale 500 par tour. Les deux ont un mode **auto** (la même mise ×5 à ×100, arrêt avec S ou quand il n’y a plus assez de points), comme les caisses (ouverture en plein écran, « Rouvrir », auto ×5 / ×10 / ×25). Un onglet *Points* s’ajoute aux classements.

## Boutique

Les points s’échangent dans la *Boutique* (✦) contre des objets **très chers** (une heure de jeu rapporte environ 1 500 points) :

- **couleurs de pseudo** (5 000 à 150 000) et **effets de pseudo** animés (15 000 à 250 000), visibles par tout le monde : salon, discussion, parties, classements, barre du haut ;
- **skins** pour les jeux à deux (jetons, symboles, pièces, pions), visibles par l’adversaire pendant la partie ;
- **titres** : prévus mais pas encore en vente. Pour en ajouter un : une ligne dans `TITLES` (`src/net/shop.ts`) et une ligne dans `public.shop_items` (exemples en commentaire dans `0008_boutique.sql`) ; un objet avec `active = false` n’est ni visible ni achetable.

**Tower defense** : une campagne de 20 niveaux (une carte et ses vagues chacun, 6 à 16 vagues, un boss aux niveaux 5, 10, 15 et 20), racontée en trois actes (`src/games/towerdefense/story.ts`), puis un mode infini classé, ouvert dès le début avec ce qui est débloqué. Terminer les niveaux débloque les tours (Alchimiste au niveau 2, Tesla 4, Sniper 6, Lance-flammes 8, Comptoir 10, Railgun 13, Singularité 16) et les améliorations : chaque tour monte deux fois, puis choisit une voie parmi deux et y monte encore deux fois (1re amélioration après le niveau 1, 2e après le 3, choix de la voie après le 5, dernière après le 9).

Les cartes varient : certaines ont 2 à 4 entrées ou plusieurs sorties (les ennemis se répartissent entre les routes, paquet par paquet), d’autres sont plus grandes (20 × 12, 22 × 13), et certaines portent une **tour spéciale** (Trébuchet, Phare, Paratonnerre, Grande baliste, Puits sans fond) qu’on débloque contre de l’or pendant la partie. Chaque niveau réussi rapporte des **étoiles** : 3 sans perdre de vie, 2 en gardant au moins la moitié des vies, 1 sinon. Elles se dépensent dans la **boutique à étoiles** (carte de la campagne) : 5 améliorations permanentes de 5 rangs (dégâts, cadence, portée, prix, or de départ), le rang n coûte n étoiles, et on peut tout récupérer pour redépenser. Les **défis de Tonton Jean-Mi** (niveaux bonus, débloqués après les niveaux 4, 8, 12, 16 et 20) ont chacun une règle qui pique : une seule vie, ennemis plus rapides, Titan au maximum, prix +40 %, puis Bagou qui revient.

La boutique mène aussi aux **caisses du tower defense** (`#/td/caisses`), payées en points :

- **Héros** (1 500) : 8 héros qui donnent un bonus à toute la partie (tours moins chères, ennemis plus lents, cadence, dégâts, portée, or, vies). Un héros déjà obtenu monte d’un niveau (5 au maximum) ; on le choisit sur la carte avant de jouer.
- **Skins de tours** et **skins d’ennemis** (1 000 chacune) : 10 finitions par tour ou ennemi, de Commun à Mythique (chances affichées), jamais de doublon. Un skin obtenu est porté tout de suite si rien ne l’était ; on change de skin sur la même page.

Valeurs d’équilibrage (tours, cartes, difficulté des niveaux, déblocages, héros) : `src/games/towerdefense/engine/data.ts` ; prix et contenu des caisses : `0030_td_roguelike.sql` et `0032_td_campagne.sql` (et `catalog.ts` côté site) ; boutique à étoiles : `PERKS` dans `data.ts` et `0033_td_etoiles.sql` (à garder identiques).

Le prix et la possession sont vérifiés par le serveur (`shop_buy`, `shop_equip`) ; un objet acheté est porté tout de suite, et peut être retiré ou remis à tout moment.

## Administration et appartement

- **Admins** : la table `public.admins` (le compte `8d86e772-…` est admin). Pour en ajouter un : `insert into public.admins (user_id) values ('<id>');` dans *SQL Editor*. Les admins n’apparaissent dans aucun classement.
- Page *Administration* (accueil ou menu ☰, admins seulement) : sur chaque joueur de la liste, trois boutons **Modifier**, **Maudire / Libérer** et **Supprimer** (deux clics ; efface le compte et tout ce qui va avec ; jamais un admin). *Modifier* ouvre la fiche : points à donner ou retirer, pseudo, objet à donner, niveau de malédiction (3 fréquences) et screamer immédiat. On y ajoute aussi les **photos** à accrocher dans les cadres. Chaque action est notée dans le journal.
- **Appartement** (`#/appart`, lien à partager `#/appart/<id>`) : des pièces en vue isométrique (deux murs du fond), où l’on pose ses meubles (`E` pour aménager, `R` pour pivoter d’un quart de tour ; un canapé 2 × 1 tourné occupe 1 × 2). Les cadres font 2 emplacements de mur de large, restent droits et affichent une photo choisie parmi celles des admins ; hors aménagement, un clic sur un cadre montre la photo en grand. Zoom : molette, pincement, boutons ou `+` `−` `0`, puis glisser pour se déplacer. L’aménagement est vérifié et enregistré par le serveur.
- **Pièces** : on commence avec l’**entrée** (6 × 5). Les autres (salon, cuisine, chambre, salle de bain, bureau, salle de jeux, chacune avec sa taille et ses couleurs) se débloquent dans l’ordre qu’on veut, de plus en plus cher : 3 000, 8 000, 20 000, 50 000, 120 000 puis 300 000 points. Des **portes** relient les pièces (l’entrée mène au salon, à la chambre et à la salle de bain ; le salon à la cuisine et à la salle de jeux ; la chambre au bureau) : un clic sur une porte ouverte fait changer de pièce ; celle d’une pièce pas encore achetée est fermée et grisée. On ne peut rien accrocher à la place d’une porte. Touches `1` à `7` ou onglets pour changer de pièce ; un meuble en main suit quand on change de pièce.
- **Nettoyage** : l’entrée est en désordre au départ. Six tâches payantes, dans l’ordre (cartons 30, ordures 80, toiles d’araignée 150, poussière 300, parquet 600, peinture 1 000) ; on ne peut meubler ni acheter de pièce qu’une fois tout nettoyé.
- **Revenus** : l’appart rapporte des points en continu, affichés par seconde : 200/h par tâche de nettoyage, et pour chaque meuble posé son prix × 0,8 par heure, multiplié selon la rareté (×1,5 Commun … ×20 Mythique). Ils sont **versés tout seuls chaque minute**, sur n’importe quelle page du site (une seule ligne « Revenus de l’appart » par heure dans l’historique) ; hors du site, ils s’accumulent jusqu’à 24 h et tombent au retour. `C` ou *Récolter maintenant* sur la page de l’appart pour ne pas attendre.
- **Meubles et caisses** : chaque meuble existe en finition standard (achetable) et en finitions rares (Rubis, Or, Néon, Diamant, Arc-en-ciel, Spectre…), qu’on n’obtient qu’en ouvrant des caisses (tirage serveur, chances affichées). Il existe aussi des **versions décorées** de chaque meuble, qui gardent sa couleur : à fleurs et à cœurs (Commun), à étoiles (Rare), à pics et à arcs-en-ciel (Épique), à nounours et en flammes (Légendaire), à couronne (Mythique). Les plus rares sont les meubles **personnalisables** (Mythique) : une fois posés, on choisit une de ses photos débloquées (`P` pour la changer), qui les recouvre entièrement en papier peint ; un clic dessus, hors aménagement, montre la photo en grand.
- **Amis** (page *Amis*, menu ☰ ou accueil) : onglets *Mes amis*, *Demandes* et *Ajouter un ami* (recherche par pseudo). Une demande arrive en notification ; si les deux s’étaient demandés, c’est accepté directement.
- On ne partage plus son appart par lien : on ne voit que le sien et ceux de ses **amis** (*Voir son appart* depuis la page Amis) ; le serveur refuse les autres (les admins voient tout).
- Dans un **salon**, la liste de ses amis avec un bouton *Inviter* : l’ami reçoit une notification où qu’il soit sur le site, *Rejoindre* l’amène dans le salon. Les invitations de la dernière heure restent dans *Amis → Demandes*. Au plus une invitation toutes les 10 s au même ami, et 6 par minute en tout.
- **Caisse souvenirs** (4 000) : 5 % de chances de débloquer une photo encore jamais obtenue, tirée au hasard parmi celles ajoutées par les admins ; sinon un meuble, avec les chances de la caisse classique. Un cadre n’affiche que des photos débloquées (les admins les ont toutes).
- L’appartement, les meubles et les caisses sont ouverts à tous les joueurs connectés (`public.apartment_allowed()`, migration `0016`).

## Touche panique

`Échap` (modifiable dans les Réglages) ou `Ctrl+Maj+Espace` masque immédiatement le jeu et affiche **un PDF de cours** dans une visionneuse (titre de l’onglet = nom du fichier), ou à défaut un faux carnet de notes. La même touche ramène au jeu, qui est en pause pendant ce temps. Dans le PDF : molette, flèches, `Page↑` `Page↓`, `Espace`.

Le PDF se choisit dans *Réglages → PDF*. Il est gardé **dans ce navigateur uniquement** (IndexedDB) et n’est jamais envoyé nulle part ; il n’est pas non plus publié avec le site (les fichiers `*.pdf` sont ignorés par git), car un support de cours est en général protégé. Les pages sont dessinées par pdf.js dans la page elle-même : la touche panique fonctionne même après un clic dans le document.

## Lancer en local

Prérequis : Node.js 20 ou plus.

```sh
npm install
npm run dev      # http://localhost:5173/travail_dur/
npm run build    # vérification TypeScript + build dans dist/
```

Sans configuration, le solo fonctionne (scores non classés) et le multijoueur affiche « multijoueur non configuré ».

## Comptes, scores et sécurité

- Chaque navigateur reçoit automatiquement un **compte invité** (connexion anonyme Supabase). Rien à saisir pour jouer.
- **Facultatif** : dans *Réglages → Compte*, on ajoute un email. Supabase envoie un **email de vérification** ; une fois le lien cliqué, le compte devient permanent (même compte, scores conservés).
- **Seuls les comptes avec un email vérifié apparaissent dans les classements.**
- Le même email permet de **retrouver son compte** sur un autre appareil (lien de connexion par email).

Rien de ce qu’envoie un client n’est cru sur parole :

- Les clients n’ont **que la lecture** sur les tables (RLS). Toute écriture passe par des fonctions SQL `security definer` qui identifient le joueur avec `auth.uid()`.
- **2048** : le serveur fournit la graine aléatoire, le client renvoie la liste de ses coups, le serveur **rejoue la partie** et calcule lui-même le score. Coup impossible, partie déjà envoyée, partie d’un autre ou jouée à plus de 25 coups/s : refusé.
- **Tetris** : même principe que 2048 (graine serveur, rejeu complet des actions). Le serveur vérifie aussi que la partie n’a pas duré moins longtemps que ses chutes automatiques.
- **Tower defense** : le serveur garde l’état de chaque partie. Au lancement, il vérifie le niveau (débloqué ou non) et le héros (possédé, et son niveau), et les améliorations de la boutique à étoiles, puis tire la graine. À la fin de chaque vague, il reçoit les constructions (avant et pendant la vague, chacune datée au dixième de seconde près) et rejoue lui-même la vague avec **le même moteur que le jeu** (fonction serveur `supabase/functions/td`, qui embarque une copie de `src/games/towerdefense/engine`) ; le classement montre le niveau atteint dans la campagne, les étoiles et la meilleure vague du mode infini, et un niveau réussi compte pour la progression de la campagne, avec ses étoiles. Les achats de la boutique à étoiles sont vérifiés en SQL (`td_perk_buy`). Les tirages des caisses sont faits en SQL (`td_crate_open`).
- **Flappy Bird** : graine serveur (position des tuyaux) et rejeu des battements d’ailes, avec contrôle de la durée.
- **Wordle** : le mot du jour est choisi par le serveur à partir d’un secret et n’est jamais envoyé avant la fin de la partie ; chaque proposition est vérifiée et colorée par le serveur, 6 au maximum. Les propositions des autres joueurs ne sont pas lisibles (elles trahiraient le mot).
- **Puissance 4 et Morpion en ligne** : chaque coup est validé et appliqué par le serveur (bon joueur, bon tour, case ou colonne valide). Victoire, nul, abandon et victoire au temps (adversaire inactif 45 s) sont décidés par le serveur.
- **Échecs, Dames, Quoridor, Quarto en ligne** : le serveur connaît toutes les règles (roque, prise en passant, promotion, mat, pat, répétition ; prise majoritaire et dames volantes ; murs qui ne doivent jamais enfermer un pion ; lignes du Quarto). Il calcule les coups légaux, refuse les autres et décide de la fin de partie. Victoire au temps après 3 minutes d’inactivité (90 s au Quarto). Les règles existent en double, en TypeScript (`src/games/<jeu>/logic.ts`) et en SQL (`0006_plateaux.sql`) : les deux doivent rester identiques.
- Pseudos : 2 à 16 caractères (lettres, chiffres, `_`, `-`), uniques sans tenir compte de la casse. Tous les textes sont insérés dans la page comme texte, jamais comme HTML.
- Le site publié porte une Content-Security-Policy stricte (scripts du site uniquement, connexions vers Supabase uniquement).

Limites connues : le serveur garantit qu’un score correspond à une vraie partie valide, pas qu’un humain l’a jouée (un bot qui joue à 2048 reste possible) ; quelqu’un qui possède plusieurs emails peut créer plusieurs comptes vérifiés. Un pseudo ou un score peut être supprimé depuis le tableau de bord Supabase (*Table Editor*).

## Configurer Supabase

1. Créer un compte sur https://supabase.com, puis **New project** (le plan gratuit suffit).
2. **SQL Editor → New query** : coller le contenu de `supabase/migrations/0001_init.sql` et l’exécuter, puis faire de même avec `0002_jeux.sql` (Tetris, Morpion), `0003_tower_defense.sql`, `0004_td_wordle_flappy.sql`, `0005_chat.sql` (discussion des salons), `0006_plateaux.sql` (Échecs, Dames, Quoridor, Quarto en ligne), `0007_points_casino.sql` (points, roulette, machine à sous), `0008_boutique.sql` (boutique), `0009_appart_admin.sql` (admins, appartement, meubles, caisses), `0010_appart_3d.sql` (appart en 3D, nettoyage, revenus, suppression de joueur), `0011_prix_appart.sql` (appart moins cher au début), `0012_rotation.sql` (rotation des meubles), `0013_pieces.sql` (pièces à débloquer, grands cadres ; les meubles déjà posés retournent dans la réserve), `0014_portes.sql` (portes entre les pièces), `0015_caisse_photos.sql` (caisse souvenirs, photos à débloquer, revenus de l’appart augmentés), `0016_appart_pour_tous.sql` (l’appart ouvert à tous), `0017_amis.sql` (amis, notifications, apparts visibles des amis seulement), `0018_versions_meubles.sql` (versions décorées des meubles, revenus de l’appart × 4), `0019_nounours_legendaire.sql` (nounours en Légendaire), `0020_meubles_perso.sql` (meubles personnalisables), `0021_revenus_auto.sql` (revenus de l’appart versés automatiquement), `0030_td_roguelike.sql` (tower defense roguelike, caisses de tours et de skins), `0031_transfert_pseudo.sql` (le pseudo choisi sur un compte invité suit quand on retrouve son compte) `0032_td_campagne.sql` (campagne de 20 niveaux, héros, mode infini classé) `0033_td_etoiles.sql` (étoiles, boutique à étoiles, défis bonus) `0034_gains.sql` (gains ×3, points à chaque partie jouée, parties solo contre l’ordinateur) `0035_classement_td.sql` (classement du tower defense : niveau de la campagne, étoiles et vague max du mode infini) et `0036_heure_serveur.sql` (heure du serveur : changer l’heure de son appareil ne change rien à l’appart). Numéros réservés : 0013 à 0029 pour l’appart, 0030 et plus pour les jeux ; les migrations de l’appart et du tower defense sont indépendantes, leur ordre entre elles n’a pas d’importance. Chaque fichier ne s’exécute qu’une fois ; une nouvelle version du site peut en ajouter un à exécuter à son tour.
   **Fonction serveur du tower defense** (une fois, puis à chaque changement de `src/games/towerdefense/engine`) : `npx supabase login`, puis `npm run td:sync` et `npx supabase functions deploy td --project-ref <id du projet>` (l’id est dans l’URL du projet). Sans elle, le tower defense reste jouable mais non classé.
   ⚠️ Si une migration de l’appart refait `revoke execute on all functions …`, il faut y garder `public.td_crate_open(text), public.td_equip(text, text), public.td_perk_buy(text), public.td_perk_reset(), public.points_solo(text, boolean)` dans la liste des `grant … to authenticated`.
3. **Authentication → Sign In / Providers** :
   - activer **Allow anonymous sign-ins** ;
   - dans **Email**, laisser **Confirm email** activé.
4. **Authentication → URL Configuration** :
   - **Site URL** : `https://fuforudude.github.io/travail_dur/`
   - **Redirect URLs** : ajouter `https://fuforudude.github.io/travail_dur/` et `http://localhost:5173/travail_dur/`
5. **Emails (important)** : le service d’envoi intégré de Supabase n’envoie qu’aux membres de l’équipe du projet, et seulement quelques emails par heure. Pour de vrais utilisateurs, il faut un service SMTP externe : voir [Envoyer les emails avec Brevo](#envoyer-les-emails-avec-brevo) ci-dessous (Resend, Mailjet ou Gmail avec un mot de passe d’application fonctionnent aussi).
6. **Authentication → Rate Limits** : tout un établissement sort souvent par **une seule adresse IP**. Augmenter la limite de connexions anonymes par IP (30 par heure par défaut), sinon les nouveaux joueurs seront bloqués. Chaque navigateur ne crée son compte qu’une fois.
7. **Project Settings → API** : récupérer la **Project URL** et la clé **anon / public**, puis en local copier `.env.example` en `.env.local` :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   et relancer `npm run dev`.

La clé *anon* est publique par nature (elle finit dans le JavaScript du site) : c’est la RLS qui protège les données. Ne jamais utiliser la clé *service_role* côté site.

### Envoyer les emails avec Brevo

Supabase sait envoyer ses emails (vérification, lien de connexion) par n’importe quel serveur SMTP. Brevo en fournit un gratuitement (environ 300 emails par jour). Les intitulés des menus peuvent varier légèrement selon les versions de Brevo et de Supabase.

**1. Dans Brevo : déclarer l’adresse d’expédition**

- Menu du compte (en haut à droite) → **Senders, Domains & Dedicated IPs** → onglet **Senders** → **Add a sender**.
- Nom : par exemple `Notes`. Email : l’adresse qui apparaîtra comme expéditeur.
- Brevo envoie un code ou un lien de confirmation à cette adresse : le valider. Tant que l’expéditeur n’est pas vérifié, les envois sont refusés.

**2. Dans Brevo : récupérer les identifiants SMTP**

- Menu du compte → **SMTP & API** → onglet **SMTP**.
- Noter le **serveur** (`smtp-relay.brevo.com`), le **port** (`587`) et le **login** (de la forme `xxxxxx@smtp-brevo.com`, différent de l’email du compte Brevo).
- **Generate a new SMTP key** → lui donner un nom (`supabase`) → copier la clé tout de suite : elle ne sera plus affichée. C’est elle, le mot de passe SMTP (et non le mot de passe du compte Brevo).

**3. Dans Supabase : brancher Brevo**

**Authentication → Emails → SMTP Settings** → activer **Enable Custom SMTP**, puis :

| Champ Supabase | Valeur |
| --- | --- |
| Sender email | l’adresse vérifiée à l’étape 1 |
| Sender name | `Notes` (ou autre) |
| Host | `smtp-relay.brevo.com` |
| Port number | `587` |
| Username | le login SMTP Brevo (`xxxxxx@smtp-brevo.com`) |
| Password | la clé SMTP générée à l’étape 2 |

Enregistrer. Ensuite, dans **Authentication → Rate Limits**, ajuster **emails envoyés par heure** (Supabase applique sa propre limite, même avec un SMTP externe).

**4. Tester**

Sur le site : *Réglages → Compte → Ajouter mon email* avec une adresse qui n’est **pas** membre du projet Supabase. L’email doit arriver en moins d’une minute. Sinon :

- **Brevo → Transactional → Logs** (ou *Statistics*) indique si l’email est parti, a été refusé ou bloqué.
- **Supabase → Logs → Auth** montre les erreurs SMTP (identifiants faux, expéditeur non vérifié…).
- Compte Brevo neuf : l’envoi transactionnel peut nécessiter que le profil soit complété ou que le compte soit validé par Brevo ; un message l’indique dans le tableau de bord.
- Email dans les **spams** : fréquent quand l’expéditeur est une adresse Gmail, Outlook… envoyée via Brevo. Pour une meilleure délivrabilité, ajouter un domaine à soi dans Brevo (onglet **Domains**, enregistrements DNS à copier). Pour un usage entre étudiants, prévenir de regarder les spams suffit souvent.

Facultatif : **Authentication → Emails → Templates** permet de traduire les emails en français (modèles *Confirm signup*, *Change Email Address* pour l’ajout d’email à un compte invité, et *Magic Link* pour retrouver son compte). Garder la variable `{{ .ConfirmationURL }}` dans le lien.

### Jouer à plusieurs

- **Créer un salon** dans l’accueil : un code de 4 lettres est généré. `C` copie le lien à partager.
- Les autres choisissent **Rejoindre un salon** et saisissent le code, ou ouvrent directement le lien (`…/#/room/ABCD`).
- Dans le salon, `←` `→` (ou un clic) pour choisir le jeu (Puissance 4, Morpion, Échecs, Dames, Quoridor ou Quarto), `↑` `↓` pour choisir un joueur, `Entrée` pour le **défier**. Le joueur défié accepte avec `O` ou refuse avec `N`. Un défi expire au bout de 2 minutes.
- Le salon a une **discussion**, visible aussi pendant les parties : `T` pour écrire, `Entrée` pour envoyer, `Échap` pour revenir au jeu. Les messages sont gardés une journée.
- En partie : `Retour arrière` deux fois pour abandonner ; si l’adversaire ne joue plus pendant 45 s, `V` réclame la victoire.

Pour tester seul : deux onglets du même navigateur partagent le même compte. Utiliser deux navigateurs, ou une fenêtre de navigation privée.

### Tester la base en local

`supabase/migrations/0001_init.sql` se charge aussi dans un Postgres 15+ classique, à condition de créer d’abord un schéma `auth` minimal (table `auth.users`, fonction `auth.uid()`, rôles `anon` et `authenticated`), ce qui permet de tester les fonctions sans projet Supabase.

## Déployer sur GitHub Pages

Le workflow `.github/workflows/deploy.yml` construit et déploie le site à chaque push sur `main`.

1. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. **Settings → Secrets and variables → Actions → New repository secret**, ajouter :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   (facultatif : sans eux, le site est déployé avec le solo seulement)
3. Pousser sur `main`. Le site est publié sur `https://fuforudude.github.io/travail_dur/`.

Si le dépôt est renommé, mettre à jour `base` dans `vite.config.ts`.

## Organisation du code

```
src/
├─ main.ts, router.ts     bootstrap et routage par hash (#/, #/game/2048, #/room/ABCD)
├─ core/                  clavier centralisé, touche panique, réglages, stockage local, son
├─ net/                   client Supabase optionnel, compte (anonyme + email), salons (presence)
├─ games/                 interface commune, registre et jeux
└─ ui/                    accueil, réglages, compte, classements, salon
supabase/migrations/      tables, règles d'accès et fonctions serveur
```

### Repères pour reprendre le code

- **Démarrage** : `src/main.ts` applique les réglages globaux, initialise la touche panique et les
  notifications, puis associe les routes hash aux vues. Les pages secondaires sont chargées à la
  demande (`src/router.ts`) ; le routeur appelle le nettoyage de la vue quittée avant d’en afficher
  une autre.
- **Contrat des jeux** : `src/games/types.ts` définit le contexte et le cycle de vie communs.
  `registry.ts` contient les métadonnées nécessaires à l’accueil et les imports différés des jeux.
- **Solo et multijoueur** : les règles et vues des jeux sont dans `src/games/`. Les matchs en ligne
  au tour par tour utilisent `src/games/online.ts` pour afficher l’état autoritaire de Supabase ;
  les RPC SQL valident les coups et la fin de partie. Les fonctions de `src/net/` sont la frontière
  entre l’interface et ces services.
- **Stockage** : `src/core/storage.ts` gère les données locales au navigateur. La progression et les
  données de compte en ligne viennent de Supabase ; les caches locaux ne remplacent pas la validation
  serveur.
- **Tower Defense** : `engine/data.ts` est la source des paramètres d’équilibrage et `engine/sim.ts`
  le moteur déterministe. La fonction Edge rejoue les actions envoyées après chaque vague ; son
  moteur TypeScript est une copie générée. Modifier le moteur côté `src/`, puis lancer
  `npm run td:sync` avant le déploiement de la fonction `td`. Ne pas éditer sa copie générée à la
  main.
- **Base de données** : les migrations définissent à la fois le schéma et une partie importante des
  règles métier. Une migration déjà exécutée ne doit pas être modifiée : ajouter une migration
  ultérieure et l’appliquer une seule fois dans l’ordre indiqué dans « Configurer Supabase ».

Validation : `npm run build` lance la synchronisation Tower Defense, `tsc` en mode strict, puis le
build Vite. Il n’y a actuellement pas de script de tests automatisés dans `package.json`.

### Ajouter un jeu

Créer un dossier dans `src/games/`, exporter un objet `Game` (voir `src/games/types.ts`) et l’ajouter à `src/games/registry.ts`. L’accueil se construit depuis le registre.

- `mount(ctx)` dessine le jeu dans `ctx.root`, installe ses abonnements/gestionnaires puis retourne
  leur fonction de nettoyage : elle est appelée quand le routeur quitte la page.
- Clavier : `pushKeys()` de `core/input.ts` (retirer le gestionnaire au nettoyage). `Retour arrière` → `ctx.onExit()`.
- Jeux en temps réel : `onPanicChange()` de `core/panic.ts` pour se mettre en pause.
- Score classé ou multijoueur : la règle du jeu doit exister **côté serveur**, dans une nouvelle migration SQL. Solo classé : sur le modèle de `g2048_replay` / `tetris_replay` et `src/net/ranked.ts`. Jeu à deux au tour par tour : ajouter le jeu à la colonne `game` de `matches` et sa règle dans `match_play`, puis réutiliser `mountOnline` (`src/games/online.ts`) avec une vue qui respecte `src/games/duel.ts`. Ne jamais écrire un score ou un état de partie depuis le client.

## Crédits

Dictionnaire du Wordle : [an-array-of-french-words](https://www.npmjs.com/package/an-array-of-french-words) (licence MIT), mots de 5 lettres sans accents.
