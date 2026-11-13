# 0006. Touche panique sur Échap ; Retour arrière pour fermer ou quitter

Date : 2026-10-19 ; consignée après coup
Statut : acceptée

## Contexte
Le site est conçu pour rester discret : appli de notes, aucun son par défaut, onglet nommé « Notes » (`README.md`, introduction et section « Touche panique »). Il faut pouvoir masquer le jeu instantanément, d'une seule touche, quel que soit l'écran.

## Décision
- La touche panique est `Échap` par défaut (`src/core/settings.ts:31`, `panicKey: 'Escape'`), modifiable dans les Réglages ; `Ctrl+Maj+Espace` fonctionne aussi (`README.md`). Elle affiche un PDF de cours ou un faux écran de notes (`src/core/panic.ts`, réglage `panicScreen`), change le titre et l'icône de l'onglet, et met les jeux en pause (`onPanicChange`).
- Conséquence : `Échap` ne sert jamais à fermer une fenêtre ou à quitter un écran. C'est `Retour arrière` qui le fait (rappels dans les aides des jeux, par exemple `src/games/board.ts:141`, et dans les commentaires, par exemple `src/ui/crateOpening.ts:42`).
- Sur téléphone, sans touche Échap : un bouton d'apparence anodine (`src/ui/layout.ts:38-40`).
- L'écran de panique est au-dessus du reste de l'interface (`#panic`, `z-index: 100`, `src/styles.css:296`).

## Options écartées
- Une autre touche par défaut : raison non consignée ; Échap est le réflexe naturel pour « sortir », mais ce n'est pas écrit.

## Conséquences
- Tout nouvel écran ou nouvelle fenêtre doit se fermer avec Retour arrière, jamais Échap, et l'indiquer dans ses aides.
- Tout nouvel élément superposé doit rester sous `z-index: 100`, sinon il resterait visible pendant la panique.
- Un champ de saisie qui réagit à Échap (comme `src/ui/chat.ts:81`, qui retire le focus) doit rester compatible avec le basculement de la panique.
