# 0005. Site hébergé sur GitHub Pages, politique CSP en balise meta

Date : 2026-10-19 ; consignée après coup
Statut : acceptée

## Contexte
Le site est une application Vite/TypeScript purement statique ; les données et les règles sont sur Supabase. GitHub Pages sert le site gratuitement depuis le dépôt (déploiement dès l'initialisation du projet, commit `e48779a`), mais ne permet pas de poser des en-têtes HTTP, donc pas de `Content-Security-Policy` par en-tête (commentaire de `vite.config.ts:3-5`).

## Décision
- Déploiement par `.github/workflows/deploy.yml` à chaque push sur `main`, avec `base: '/travail_dur/'` (`vite.config.ts:47`).
- La politique CSP est injectée au build dans une balise `<meta http-equiv="Content-Security-Policy">` par le plugin `csp` de `vite.config.ts` : `default-src 'self'`, scripts et styles `'self'` uniquement, connexions limitées au domaine Supabase (HTTPS et WSS), images `'self'`, `data:` et Supabase, ni `object`, ni `base`, ni formulaire.
- La balise n'est ajoutée qu'au build (`apply: 'build'`) : en dev, le client Vite a besoin de son websocket et de styles injectés.

## Options écartées
- Un hébergeur avec en-têtes HTTP : raison non consignée à l'époque (GitHub Pages est gratuit et déjà en place).

## Conséquences
- Coût nul et déploiement automatique, mais pas de contrôle serveur sur les en-têtes.
- La CSP interdit les styles et scripts en ligne : pas de `style="…"` dans le HTML, pas d'attribut `style` posé par `setAttribute` ; passer par `element.style.x = …` ou `style.setProperty`.
- Les erreurs de CSP n'apparaissent pas en développement : pour toute interface, vérifier sur le build (`npm run build`, puis `npx vite preview`).
- Une balise meta ne couvre pas tout ce qu'un en-tête permet (par exemple `frame-ancestors` y est ignoré) : limite non contournée.
- Si l'API de l'ADR 0001 est mise en ligne, son domaine devra être ajouté à `connect-src`.
