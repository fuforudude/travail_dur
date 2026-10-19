# travail_dur

Petite plateforme de mini-jeux jouables **entièrement au clavier**, en solo ou à plusieurs (salons avec code), conçue pour rester discrète : apparence sobre, aucun son par défaut, onglet nommé « Notes » et **touche panique**.

En ligne : https://fuforudude.github.io/travail_dur/

## Jeux

| Jeu | Modes | Touches |
| --- | --- | --- |
| 2048 | solo, classé | flèches, WASD ou ZQSD · `R` recommencer |
| Puissance 4 | solo contre l’ordinateur, ou en ligne à 2 (classé) | `←` `→` colonne · `Entrée` / `Espace` / `↓` jouer · `R` revanche |

Partout : `↑` `↓` + `Entrée` pour naviguer, `Retour arrière` pour revenir.

## Touche panique

`Échap` (modifiable dans les Réglages) ou `Ctrl+Maj+Espace` masque immédiatement le jeu et affiche un faux document de cours (« Notes – Cours »). La même touche ramène au jeu, qui est en pause pendant ce temps.

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
- **Puissance 4 en ligne** : chaque coup est validé et appliqué par le serveur (bon joueur, bon tour, colonne valide). Victoire, nul, abandon et victoire au temps (adversaire inactif 45 s) sont décidés par le serveur.
- Pseudos : 2 à 16 caractères (lettres, chiffres, `_`, `-`), uniques sans tenir compte de la casse. Tous les textes sont insérés dans la page comme texte, jamais comme HTML.
- Le site publié porte une Content-Security-Policy stricte (scripts du site uniquement, connexions vers Supabase uniquement).

Limites connues : le serveur garantit qu’un score correspond à une vraie partie valide, pas qu’un humain l’a jouée (un bot qui joue à 2048 reste possible) ; quelqu’un qui possède plusieurs emails peut créer plusieurs comptes vérifiés. Un pseudo ou un score peut être supprimé depuis le tableau de bord Supabase (*Table Editor*).

## Configurer Supabase

1. Créer un compte sur https://supabase.com, puis **New project** (le plan gratuit suffit).
2. **SQL Editor → New query** : coller le contenu de `supabase/migrations/0001_init.sql` et l’exécuter (une seule fois).
3. **Authentication → Sign In / Providers** :
   - activer **Allow anonymous sign-ins** ;
   - dans **Email**, laisser **Confirm email** activé.
4. **Authentication → URL Configuration** :
   - **Site URL** : `https://fuforudude.github.io/travail_dur/`
   - **Redirect URLs** : ajouter `https://fuforudude.github.io/travail_dur/` et `http://localhost:5173/travail_dur/`
5. **Emails (important)** : le service d’envoi intégré de Supabase n’envoie qu’aux membres de l’équipe du projet, et seulement quelques emails par heure. Pour de vrais utilisateurs, configurer un SMTP dans **Authentication → Emails → SMTP Settings** (Brevo, Resend, Mailjet… ont des offres gratuites).
6. **Authentication → Rate Limits** : tout un établissement sort souvent par **une seule adresse IP**. Augmenter la limite de connexions anonymes par IP (30 par heure par défaut), sinon les nouveaux joueurs seront bloqués. Chaque navigateur ne crée son compte qu’une fois.
7. **Project Settings → API** : récupérer la **Project URL** et la clé **anon / public**, puis en local copier `.env.example` en `.env.local` :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   et relancer `npm run dev`.

La clé *anon* est publique par nature (elle finit dans le JavaScript du site) : c’est la RLS qui protège les données. Ne jamais utiliser la clé *service_role* côté site.

### Jouer à plusieurs

- **Créer un salon** dans l’accueil : un code de 4 lettres est généré. `C` copie le lien à partager.
- Les autres choisissent **Rejoindre un salon** et saisissent le code, ou ouvrent directement le lien (`…/#/room/ABCD`).
- Dans le salon, `↑` `↓` pour choisir un joueur, `Entrée` pour le **défier** à Puissance 4. Le joueur défié accepte avec `O` ou refuse avec `N`. Un défi expire au bout de 2 minutes.
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
- Score classé ou multijoueur : la règle du jeu doit exister **côté serveur** (fonctions SQL, comme `g2048_replay` ou `c4_play`). Ne jamais écrire un score ou un état de partie depuis le client.
