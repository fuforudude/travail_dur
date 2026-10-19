# Plan — Plateforme de mini-jeux discrète (solo + multi)

Dépôt : https://github.com/fuforudude/travail_dur.git (actuellement **vide**, branche `main`).

## Objectif

Une petite plateforme web de mini-jeux jouables **uniquement au clavier**, en **solo** ou en **multijoueur** (salons avec code), pensée pour être **discrète en cours** : apparence sobre, aucun son par défaut, touche panique.

## Stack (à respecter)

- **Vite + TypeScript vanilla** (pas de framework UI). CSS simple, sans librairie.
- **Supabase Realtime** (canaux *broadcast* + *presence*) pour le multi. Aucun backend à écrire, aucune table nécessaire pour la V1.
- **GitHub Pages** pour l'hébergement, déployé par GitHub Actions à chaque push sur `main`.
- Routage par hash (`#/`, `#/game/2048`, `#/room/ABCD`) pour fonctionner sur GitHub Pages sans configuration serveur.
- Variables d'environnement : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (fichier `.env.local` en local, secrets GitHub pour le CI). Fournir un `.env.example`. **Si elles sont absentes, le solo doit fonctionner normalement et le multi afficher « multijoueur non configuré ».**

## Arborescence cible

```
/
├─ index.html
├─ vite.config.ts            # base: '/travail_dur/'
├─ .env.example
├─ .github/workflows/deploy.yml
├─ README.md                 # lancer en local, configurer Supabase, déployer
└─ src/
   ├─ main.ts                # bootstrap + routeur
   ├─ router.ts
   ├─ styles.css             # thème sobre, variables CSS
   ├─ core/
   │  ├─ panic.ts            # touche panique + faux écran
   │  ├─ input.ts            # gestion clavier centralisée
   │  ├─ storage.ts          # meilleurs scores, réglages (localStorage, avec try/catch)
   │  └─ settings.ts         # pseudo, thème, son on/off, touche panique
   ├─ net/
   │  ├─ supabase.ts         # client (null si non configuré)
   │  └─ room.ts             # créer/rejoindre un salon, presence, broadcast
   ├─ games/
   │  ├─ types.ts            # interface Game commune
   │  ├─ registry.ts         # liste des jeux
   │  ├─ g2048/
   │  └─ connect4/
   └─ ui/
      ├─ home.ts             # liste des jeux, navigation clavier
      └─ lobby.ts            # écran de salon (code, joueurs, prêt)
```

## Interface commune des jeux

```ts
export interface GameContext {
  root: HTMLElement;
  mode: 'solo' | 'multi';
  room?: Room;              // présent en multi
  me: { id: string; name: string };
  onExit(): void;
}
export interface Game {
  id: string;
  name: string;
  modes: ('solo' | 'multi')[];
  minPlayers?: number;
  maxPlayers?: number;
  mount(ctx: GameContext): () => void;   // retourne une fonction de nettoyage
}
```

Chaque jeu s'enregistre dans `registry.ts`. L'accueil se construit à partir du registre.

## Exigences « discrétion »

1. **Touche panique** : `Échap` par défaut (configurable). Elle masque instantanément le jeu et affiche un faux écran crédible (une page de prise de notes ou un faux document de cours avec du texte statique), change `document.title` en « Notes – Cours » et remplace la favicon par une icône neutre. Un nouvel appui (ou `Ctrl+Shift+Espace` si `Échap` est déjà utilisé par le jeu) revient au jeu, **mis en pause** pendant le faux écran.
2. Titre d'onglet et favicon neutres en permanence (par ex. « Notes »).
3. Thème par défaut gris clair, faible contraste, sans couleurs flashy. Thème sombre en option.
4. **Aucun son** par défaut.
5. Pas d'animations voyantes. Les transitions restent courtes et sobres.
6. Tout est jouable au clavier : navigation dans l'accueil (flèches + Entrée), menus et jeux. Aucun clic nécessaire.
7. Mise en page qui fonctionne dans une petite fenêtre et sur mobile (le clavier reste la cible principale).

## Multijoueur (Supabase Realtime)

- **Créer un salon** : code aléatoire de 4 lettres majuscules (sans caractères ambigus), canal `room:<CODE>`.
- **Rejoindre** : saisie du code, ou lien direct `#/room/ABCD`.
- **Presence** pour afficher la liste des joueurs (pseudo) et l'état « prêt ».
- Le **premier joueur arrivé est l'hôte**. Si l'hôte part, le plus ancien restant prend le relais. L'hôte choisit le jeu et lance la partie.
- **Broadcast** pour les messages de jeu : `{ type, payload, from, seq }`.
- **Jeux au tour par tour** : l'état fait autorité chez l'hôte, qui valide les coups et diffuse l'état complet après chaque coup (simple et robuste aux désynchronisations).
- Gérer la déconnexion d'un joueur en cours de partie (message, puis retour au salon).
- Pseudo stocké en local, demandé à la première visite (valeur par défaut aléatoire, par ex. « Hibou42 »).

## Jeux de la V1

### 1. 2048 (solo)
- Flèches ou WASD/ZQSD pour jouer, `R` pour recommencer.
- Score et meilleur score persistés.
- Détection de victoire (2048) avec possibilité de continuer, et de défaite.

### 2. Puissance 4 (multi 2 joueurs, plus une variante solo contre une IA simple)
- `←`/`→` pour déplacer le jeton, `Entrée`/`Espace`/`↓` pour le lâcher.
- Indicateur de tour, détection victoire ou nul, bouton « revanche » au clavier.
- IA solo : jouer un coup gagnant s'il existe, sinon bloquer, sinon jouer au centre ou au hasard.

## Étapes de réalisation (dans l'ordre, un commit par étape)

1. **Initialisation** : Vite + TS, `.gitignore`, `README.md`, `vite.config.ts` (`base: '/travail_dur/'`), workflow GitHub Pages. Vérifier que `npm run build` passe.
2. **Socle UI** : routeur par hash, styles et thèmes, accueil navigable au clavier, réglages (pseudo, thème, son, touche panique), stockage local.
3. **Touche panique** avec faux écran, titre et favicon neutres, pause des jeux.
4. **2048** complet.
5. **Couche réseau** : client Supabase optionnel, `room.ts` (créer/rejoindre, presence, broadcast, hôte), écran de salon.
6. **Puissance 4** solo contre IA, puis en multi via le salon.
7. **Finitions** : README complet (setup Supabase pas à pas : créer le projet, récupérer l'URL et la clé anon, les ajouter en secrets GitHub `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, activer Pages via « GitHub Actions »), tests manuels, accessibilité clavier.

## Critères de fin de V1

- `npm run dev` lance le site en local, et `npm run build` passe sans erreur TypeScript.
- Sans configuration Supabase, l'accueil, les réglages, la touche panique, 2048 et Puissance 4 contre l'IA fonctionnent.
- Avec Supabase configuré, deux onglets ou deux machines peuvent créer et rejoindre un salon et jouer une partie complète de Puissance 4, revanche comprise.
- `Échap` masque le jeu en moins d'une frame et rien de « jeu » ne reste visible (titre, favicon, contenu).
- Le site est déployé sur `https://fuforudude.github.io/travail_dur/` après un push sur `main`.

## Idées pour la suite (hors V1)

- Solo : Snake, Tetris, Démineur au clavier, test de frappe.
- Multi : course de frappe (temps réel), Wordle en duel, Snake en duel, Morpion.
- Classement entre amis (table Supabase), historique des parties.
- Mode « ultra discret » : rendu en texte monospace façon terminal.
