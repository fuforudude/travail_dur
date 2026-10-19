# travail_dur

Petite plateforme de mini-jeux jouables **entièrement au clavier**, en solo ou à plusieurs (salons avec code), conçue pour rester discrète : apparence sobre, aucun son par défaut, onglet nommé « Notes » et **touche panique**.

En ligne : https://fuforudude.github.io/travail_dur/

## Jeux

| Jeu | Modes | Touches |
| --- | --- | --- |
| 2048 | solo | flèches, WASD ou ZQSD · `R` recommencer |
| Puissance 4 | solo contre l’ordinateur, ou 2 joueurs en salon | `←` `→` colonne · `Entrée` / `Espace` / `↓` jouer · `R` revanche |

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

Sans configuration, le solo fonctionne et le multijoueur affiche « multijoueur non configuré ».

## Configurer le multijoueur (Supabase)

Le multijoueur utilise uniquement **Supabase Realtime** (canaux *broadcast* et *presence*) : aucune table ni aucun backend à écrire.

1. Créer un compte sur https://supabase.com, puis **New project** (le plan gratuit suffit).
2. Dans le projet : **Project Settings → API**. Récupérer :
   - **Project URL** (`https://xxxx.supabase.co`)
   - la clé **anon / public**
3. En local : copier `.env.example` en `.env.local` et y coller ces deux valeurs :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   Relancer `npm run dev`.
4. Realtime est actif par défaut. Si la connexion au salon échoue, vérifier dans les réglages Realtime du projet que les canaux publics sont autorisés (l’option qui n’autorise que les canaux privés doit rester désactivée).

La clé *anon* est publique par nature : elle finit dans le JavaScript du site. Ne jamais utiliser la clé *service_role*.

### Jouer à plusieurs

- **Créer un salon** dans l’accueil : un code de 4 lettres est généré. `C` copie le lien à partager.
- Les autres choisissent **Rejoindre un salon** et saisissent le code, ou ouvrent directement le lien (`…/#/room/ABCD`).
- Chacun se met prêt avec `R`. L’hôte (le premier arrivé) choisit le jeu avec `←` `→` et lance avec `Entrée`.
- Si l’hôte part, le plus ancien joueur restant prend le relais. Si un joueur se déconnecte en pleine partie, tout le monde revient au salon.

Pour tester seul : deux onglets suffisent (chaque onglet est un joueur distinct).

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
├─ net/                   client Supabase optionnel, salons (presence + broadcast)
├─ games/                 interface commune, registre et jeux
└─ ui/                    accueil, réglages, salon
```

### Ajouter un jeu

Créer un dossier dans `src/games/`, exporter un objet `Game` (voir `src/games/types.ts`) et l’ajouter à `src/games/registry.ts`. L’accueil et le choix du jeu dans les salons se construisent depuis le registre.

- `mount(ctx)` dessine le jeu dans `ctx.root` et retourne une fonction de nettoyage.
- Clavier : `pushKeys()` de `core/input.ts` (retirer le gestionnaire au nettoyage). `Retour arrière` → `ctx.onExit()`.
- Jeux en temps réel : `onPanicChange()` de `core/panic.ts` pour se mettre en pause.
- Multi au tour par tour : l’hôte (`ctx.room.isHost`) valide les coups et diffuse l’état complet avec `room.send()` ; les autres envoient leurs coups et appliquent l’état reçu (voir Puissance 4).
