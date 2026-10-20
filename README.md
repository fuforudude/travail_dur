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
| Tower defense | solo, classé (vagues infinies) | flèches case · `1` `2` `3` construire · `U` améliorer · `S` vendre · `Espace` lancer la vague · `F` vitesse ×1/×2/×3 · `P` pause ; on construit et on améliore aussi pendant les vagues |
| Puissance 4 | solo contre l’ordinateur, ou en ligne à 2 (classé) | `←` `→` colonne · `Entrée` / `Espace` / `↓` jouer · `R` revanche |
| Morpion | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches ou `1`–`9` case · `Entrée` jouer · `R` revanche |
| Échecs | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches case · `Entrée` choisir la pièce puis la case · promotion `D` `T` `F` `C` · `R` revanche |
| Dames (internationales, 10×10) | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches case · `Entrée` sur la pièce puis sur chaque arrêt de la rafle · `R` revanche |
| Quoridor (« corridor ») | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches case · `Entrée` avancer · `M` mode mur · `Espace` tourner le mur · `R` revanche ; à la souris, clic entre deux cases pour un mur |
| Quarto | solo contre l’ordinateur, ou en ligne à 2 (classé) | flèches · `Entrée` poser puis donner une pièce · `Tab` plateau ↔ réserve · `R` revanche |

Dans chaque jeu de plateau, `I` (ou le bouton *Règles*) affiche les règles complètes. En solo, les camps s’échangent à chaque revanche.

Partout : `↑` `↓` + `Entrée` pour naviguer, `Retour arrière` pour revenir.

## Points et casino

Chaque partie terminée rapporte des **points**, attribués par le serveur quand il enregistre la partie (le client ne peut ni choisir ni gonfler ses gains). Le barème complet est sur la page *Points* (◆ en haut à droite) :

| Jeu | Points |
| --- | --- |
| 2048 | √score, + 30 / 150 / 400 pour les tuiles 1024 / 2048 / 4096 |
| Tetris | √score |
| Flappy Bird | tuyaux^1,5 ÷ 4 |
| Tower defense | 2 × n pour chaque vague n terminée |
| Wordle | trouvé en n essais : 40 + 15 × (6 − n) ; raté : 5 |
| À deux | victoire : Morpion 15 · Puissance 4 30 · Quarto 40 · Quoridor 60 · Dames 90 · Échecs 100 ; nul un tiers ; défaite 3 ; abandon ou temps : moitié |
| Records | record personnel +100, record absolu (tous joueurs) +500 |

Le barème vise environ 20 à 30 points par minute de jeu, quel que soit le jeu. 100 points de bienvenue ; les parties jouées avant l’arrivée des points ont été comptées (sans les bonus de record). Anti-abus : les parties à deux trop courtes ne rapportent rien, ni au-delà de 10 parties par jour contre le même adversaire.

Les points se misent à la **roulette** (européenne : rouge, noir, vert, pair, impair, manque, passe, douzaines, numéro plein ; retour 97,3 %) et à la **machine à sous** (3 rouleaux, jusqu’à ×400 ; retour 95,9 %). Le tirage est fait par le serveur ; mise maximale 500 par tour. Un onglet *Points* s’ajoute aux classements.

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
- **Tower defense** : le serveur garde l’état de chaque partie. À la fin de chaque vague, il reçoit les constructions (avant et pendant la vague, chacune datée au dixième de seconde près), les valide (or, emplacement) et rejoue lui-même la vague ; le classement retient la meilleure vague atteinte.
- **Flappy Bird** : graine serveur (position des tuyaux) et rejeu des battements d’ailes, avec contrôle de la durée.
- **Wordle** : le mot du jour est choisi par le serveur à partir d’un secret et n’est jamais envoyé avant la fin de la partie ; chaque proposition est vérifiée et colorée par le serveur, 6 au maximum. Les propositions des autres joueurs ne sont pas lisibles (elles trahiraient le mot).
- **Puissance 4 et Morpion en ligne** : chaque coup est validé et appliqué par le serveur (bon joueur, bon tour, case ou colonne valide). Victoire, nul, abandon et victoire au temps (adversaire inactif 45 s) sont décidés par le serveur.
- **Échecs, Dames, Quoridor, Quarto en ligne** : le serveur connaît toutes les règles (roque, prise en passant, promotion, mat, pat, répétition ; prise majoritaire et dames volantes ; murs qui ne doivent jamais enfermer un pion ; lignes du Quarto). Il calcule les coups légaux, refuse les autres et décide de la fin de partie. Victoire au temps après 3 minutes d’inactivité (90 s au Quarto). Les règles existent en double, en TypeScript (`src/games/<jeu>/logic.ts`) et en SQL (`0006_plateaux.sql`) : les deux doivent rester identiques.
- Pseudos : 2 à 16 caractères (lettres, chiffres, `_`, `-`), uniques sans tenir compte de la casse. Tous les textes sont insérés dans la page comme texte, jamais comme HTML.
- Le site publié porte une Content-Security-Policy stricte (scripts du site uniquement, connexions vers Supabase uniquement).

Limites connues : le serveur garantit qu’un score correspond à une vraie partie valide, pas qu’un humain l’a jouée (un bot qui joue à 2048 reste possible) ; quelqu’un qui possède plusieurs emails peut créer plusieurs comptes vérifiés. Un pseudo ou un score peut être supprimé depuis le tableau de bord Supabase (*Table Editor*).

## Configurer Supabase

1. Créer un compte sur https://supabase.com, puis **New project** (le plan gratuit suffit).
2. **SQL Editor → New query** : coller le contenu de `supabase/migrations/0001_init.sql` et l’exécuter, puis faire de même avec `0002_jeux.sql` (Tetris, Morpion), `0003_tower_defense.sql`, `0004_td_wordle_flappy.sql`, `0005_chat.sql` (discussion des salons) `0006_plateaux.sql` (Échecs, Dames, Quoridor, Quarto en ligne) et `0007_points_casino.sql` (points, roulette, machine à sous). Chaque fichier ne s’exécute qu’une fois, dans l’ordre ; une nouvelle version du site peut en ajouter un (`0003_…`) à exécuter à son tour.
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

### Ajouter un jeu

Créer un dossier dans `src/games/`, exporter un objet `Game` (voir `src/games/types.ts`) et l’ajouter à `src/games/registry.ts`. L’accueil se construit depuis le registre.

- `mount(ctx)` dessine le jeu dans `ctx.root` et retourne une fonction de nettoyage.
- Clavier : `pushKeys()` de `core/input.ts` (retirer le gestionnaire au nettoyage). `Retour arrière` → `ctx.onExit()`.
- Jeux en temps réel : `onPanicChange()` de `core/panic.ts` pour se mettre en pause.
- Score classé ou multijoueur : la règle du jeu doit exister **côté serveur**, dans une nouvelle migration SQL. Solo classé : sur le modèle de `g2048_replay` / `tetris_replay` et `src/net/ranked.ts`. Jeu à deux au tour par tour : ajouter le jeu à la colonne `game` de `matches` et sa règle dans `match_play`, puis réutiliser `mountOnline` (`src/games/online.ts`) avec une vue qui respecte `src/games/duel.ts`. Ne jamais écrire un score ou un état de partie depuis le client.

## Crédits

Dictionnaire du Wordle : [an-array-of-french-words](https://www.npmjs.com/package/an-array-of-french-words) (licence MIT), mots de 5 lettres sans accents.
