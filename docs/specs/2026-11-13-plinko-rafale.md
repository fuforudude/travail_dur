# Plinko en rafale (spam-clic)

Statut : validée
Date : 2026-11-13

## Besoin
Le Plinko n'a d'intérêt que si l'on peut lâcher des billes en rafale. Aujourd'hui, une bille = un appel au serveur et la limite du casino est de 12 mises par 10 s : on plafonne à 1,2 bille par seconde. Le joueur veut pouvoir lancer **15 billes par seconde, pendant plusieurs minutes**, sans saturer le serveur ni noyer l'historique des points.

## Périmètre
- Dedans : envoi groupé des billes (un appel tire plusieurs billes), limite propre au Plinko (15 billes/s par joueur, seau à jetons côté serveur), rafale au clic et à la touche Espace maintenue, vitesse « rapide » du mode auto, une ligne d'historique par envoi groupé, page « Regarder » qui rejoue les envois groupés.
- Hors périmètre : roulette et machine à sous (leur limite de 12 mises / 10 s ne change pas), regroupement de l'historique par minute.

## Règles
- **Limite** : 15 billes par seconde par joueur, au Plinko seulement. Seau à jetons : capacité 15, recharge 15 jetons/s, 1 jeton par bille. Une rafale de 15 d'un coup est possible, et 15/s se tient indéfiniment.
- **Clics en trop** (au-delà de 15/s) : ignorés côté site, sans message, sans mise. Le serveur refuse de toute façon ce qui dépasse (il tire seulement le nombre autorisé et renvoie le nombre refusé ; le site rend la mise des billes refusées au solde local).
- **Envoi** : un seul appel en vol par page. Le premier clic part tout de suite ; les clics arrivés pendant l'appel s'accumulent et partent ensemble dans l'appel suivant. Au plus 15 billes par appel. Un envoi groupé a une seule mise, un seul nombre de rangées et un seul risque : changer la mise vide d'abord la file en cours dans un envoi séparé (rangées et risque restent bloqués tant qu'une bille est en attente ou en l'air, comme aujourd'hui).
- **Billes d'un même envoi** : lâchées décalées de 1/15 s, chacune sur son chemin.
- **Solde local** (inchangé dans son principe) : mise retirée au clic, gain ajouté à l'arrivée de chaque bille, mise rendue pour une bille refusée, recalage sur le solde du serveur quand plus aucune bille n'est en attente ni en l'air.
- **Espace maintenue** : rafale à 15 billes/s, rythme tenu par le site (minuteur), pas par la répétition du clavier ; arrêt au relâchement de la touche ou quand la fenêtre perd le focus.
- **Mode auto** : quantités ×5 à ×100 inchangées, plus un choix de vitesse : normale (1 bille/s, comme aujourd'hui) ou rapide (15 billes/s).
- **Historique des points** : une ligne par envoi groupé, ex. « Plinko : 4 billes, misé 40, gagné 52 ».
- **Solde insuffisant** : le serveur tire autant de billes que le solde le permet (mise × nombre ≤ solde) et refuse le reste ; s'il n'en tire aucune, erreur « pas assez de points », rien n'est débité.
- **Gain** : comme aujourd'hui, `floor(mise × mult_x100 / 100)` par bille, calcul en `numeric`.
- **Mise en page** : sur ordinateur, le plateau au centre et **tous les réglages dans une colonne à droite** (mise, rangées, risque, bouton de lancer, mode auto et sa vitesse, solde, résultat, règles), le tout visible **sans faire défiler la page** (le plateau se dimensionne sur la hauteur disponible). Sur écran étroit (téléphone), les réglages passent sous le plateau, compacts.
- Les envois groupés du Plinko comptent chacun pour une mise dans la limite de la roulette et de la machine à sous (12 / 10 s) : juste après une longue rafale, la roulette peut demander d'attendre quelques secondes. Accepté.

## Critères d'acceptation
- [ ] En cliquant aussi vite que possible pendant 3 minutes, le joueur lâche environ 15 billes par seconde sans aucun message d'erreur ; les clics au-delà ne débitent rien.
- [ ] Le serveur accepte une rafale de 15 billes d'un coup, refuse la 16ᵉ dans la même seconde (renvoyée comme refusée, non débitée), puis en accepte à nouveau 15 une seconde plus tard ; tenu sur une longue série (test SQL avec horloge simulée ou attente).
- [ ] Un appel ne tire jamais plus de 15 billes, ni plus que le solde ne permet ; chaque bille respecte : longueur du chemin = rangées, case = somme du chemin, multiplicateur de la table, gain = `floor(mise × mult / 100)` ; mise totale et gain total exacts ; solde final exact.
- [ ] Un envoi groupé = une seule ligne `point_events` (« Plinko : N billes, misé …, gagné … ») et une seule ligne `casino_spins`.
- [ ] Rangées hors 8–16, risque inconnu, nombre hors 1–15, mise < 1 : refus avant tout effet (pas de jeton consommé, rien de débité).
- [ ] La table du seau à jetons n'est ni lisible ni modifiable par les joueurs ; la nouvelle fonction est ajoutée volontairement à `supabase/tests/public-functions.txt` ; l'ancienne `casino_plinko` marche toujours (pages déjà ouvertes).
- [ ] Le site n'a jamais plus d'un appel Plinko en vol ; les clics pendant un appel partent dans l'appel suivant.
- [ ] Espace maintenue lance 15 billes/s et s'arrête au relâchement ou à la perte du focus.
- [ ] Mode auto rapide : ×100 se joue en moins de 8 secondes ; S l'arrête ; arrêt si le solde ne suffit plus.
- [ ] Un ami qui regarde voit chaque envoi groupé rejoué (billes décalées de 1/15 s) sans retard qui s'accumule pendant une rafale de plusieurs minutes ; les anciennes lignes à une seule bille restent lisibles.
- [ ] Une trentaine de billes à l'écran en même temps restent fluides (une rafale à 15/s en 16 rangées).
- [ ] Sur un écran d'ordinateur (1280 × 720 et plus), la page Plinko tient sans barre de défilement : plateau au centre, tous les réglages dans une colonne à droite ; sur téléphone, les réglages sont sous le plateau.

## Contrat entre le serveur et le site
- Fonction `public.casino_plinko_batch(bet bigint, rows int, risk text, n int) returns jsonb` :
  `{ "paths": [[0,1,…], …], "slots": [9, …], "mults_x100": [300, …], "refused": 0, "stake": 400, "payout": 520, "balance": 12345 }` ; `paths`, `slots`, `mults_x100` ont autant d'éléments que de billes tirées (`n − refused`), `stake` et `payout` sont les totaux de l'envoi.
- Journal spectateur : une ligne `casino_spins` par envoi, `game = 'plinko'`, `detail = { "rows", "risk", "bet", "paths", "slots", "mults_x100" }`. L'ancien format (`path`, `slot`, `mult_x100` d'une seule bille) reste à lire.
- Table `public.plinko_rate (user_id uuid primary key, tokens numeric not null, at timestamptz not null)`, sans aucun droit pour les joueurs.

## Tâches
1. **Serveur** — `supabase/migrations/0053_plinko_rafale.sql` : table `plinko_rate`, fonction `casino_plinko_batch` (validations d'abord, verrou du portefeuille, seau à jetons, solde, tirages, `casino_settle` une fois, `casino_spin_log` une fois) ; tests dans `scripts/sql-test.mjs` ; `public-functions.txt`.
2. **Site** — `src/net/points.ts` (`spinPlinkoBatch`), `src/ui/plinko.ts` (file des clics, un appel en vol, seau à jetons local pour ignorer les clics en trop, lâcher décalé, Espace maintenue, vitesse de l'auto), `src/ui/plinkoBoard.ts` si besoin pour la fluidité.
3. **Regarder** — `src/net/spectate.ts`, `src/ui/spinStage.ts` : rejouer `detail.paths` décalées, garder l'ancien format, rattrapage pendant une longue rafale. En parallèle de la tâche 2 (fichiers distincts).

## Impacts
- Données / migrations : `0053_plinko_rafale.sql` (1 table, 1 fonction). Aucune donnée existante transformée.
- API : `rpc casino_plinko_batch(bet, rows, risk, n)` ; `casino_plinko` conservée.
- Écrans : page Plinko, page et fenêtre « Regarder ».

## Décisions techniques
| Question | Options envisagées | Choix | Raison |
|---|---|---|---|
| Comment tenir 15 billes/s ? | Billes regroupées par appel ; un appel par bille avec limite relevée | Billes regroupées | ~4 appels/s au lieu de 15 par joueur, 4 lignes d'historique au lieu de 15 ; tient plusieurs joueurs sur l'offre gratuite |
| Quand le site envoie-t-il ? | Un appel à la fois, le reste suit ; envoi toutes les 250 ms | Un appel à la fois | Aucun délai pour une bille seule, regroupement adapté à la vitesse du réseau |
| Comment le serveur limite-t-il ? | Seau à jetons par joueur ; compter les billes de la dernière seconde | Seau à jetons (table `plinko_rate`) | Exact, coût constant, rafale de 15 puis 15/s sans fin |
| Espace maintenue ? | Rafale à 15/s ; une bille par appui | Rafale, rythme tenu par un minuteur | Spam au clavier, indépendant de la répétition du clavier de chaque ordinateur |
| Ancienne fonction `casino_plinko` ? | La garder ; la retirer | La garder | Compatible avec les pages déjà ouvertes (règle des migrations) ; retrait possible plus tard |

### Décisions prises après les contrôles
| Question | Options envisagées | Choix | Raison |
|---|---|---|---|
| Ordre des résultats chez le spectateur | Ordre des envois ; ordre d'arrivée des billes | Les billes tombent en parallèle, le texte du résultat et le solde suivent l'ordre des envois (résultats chaînés) | Jamais un vieux solde qui écrase le récent |
| Spectateur très en retard (onglet caché) | Sauter au direct ; accélérer le lâcher | Au-delà de 8 envois en attente ou au retour sur l'onglet : les envois en retard vont dans l'historique sans animation, seul le dernier est rejoué | Le principe de la page est le direct |
| Montrer qu'il y a plusieurs billes | Fil des multiplicateurs ; case qui rebondit ; variation des trajectoires ; compteur | Les quatre | Lisibilité d'une rafale |
| Limiter le nombre d'appels au serveur | Second seau 8 appels/s ; écart minimal de 100 ms | Second seau à 8 appels/s, refus avant toute écriture ; plus un index `casino_spins (user_id, created_at)` | Un script ne peut plus multiplier les appels coûteux ; le site (~4 appels/s) n'est jamais gêné |

## Décisions du besoin (entretien)
Limite propre au Plinko (roulette et machine à sous inchangées) ; clics en trop ignorés sans message ; une ligne d'historique par envoi groupé ; mode auto avec vitesse normale ou rapide ; réglages dans une colonne à droite et plateau au centre, sans défilement.

## Questions ouvertes
- Aucune.
