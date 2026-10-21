# API du site (VPS)

Le site (GitHub Pages) appelle cette API pour tout ce qui décide ou calcule ; l'API parle à la base
Postgres de Supabase. Supabase garde la connexion des joueurs (Auth) et le temps réel.

```
site ──HTTPS──▶ Caddy (VPS) ──▶ API Node (127.0.0.1:8787) ──▶ Postgres Supabase (pooler)
  └── connexion, temps réel ──▶ Supabase
```

## Organisation

| Dossier | Rôle |
| --- | --- |
| `src/<domaine>/<domaine>.controller.ts` | routes HTTP : lit la requête, appelle le service, renvoie du JSON. Aucune règle. |
| `src/<domaine>/<domaine>.service.ts` | les règles du domaine. Chaque action est une transaction. |
| `src/<domaine>/<domaine>.repo.ts` | lectures et écritures SQL, sans règle. |
| `src/db.ts` | interface `Db` (requête, transaction) : `pg` en production, PGlite dans les tests. |
| `src/http/` | identification du joueur (jeton Supabase) et erreurs (`{ error }` + statut). |
| `../shared/` | règles et catalogues partagés avec le site : le site s'en sert pour l'aperçu et l'affichage, l'API pour décider. |

Domaines déjà sur l'API : **appart** (ménage, pièces, équipements, aménagement, revenus, achat et
revente de meubles). Le reste du site appelle encore les fonctions SQL de Supabase ; on les migre
une par une, puis on retire aux joueurs le droit d'appeler l'ancienne fonction SQL.

Tant que les points ne sont pas migrés, l'API débite et crédite par `public.points_spend` et
`public.points_add` (une seule façon de toucher au solde).

## En local

```sh
cp server/.env.example server/.env   # puis renseigner DATABASE_URL
npm run server:dev                   # API sur http://localhost:8787, relancée à chaque modification
npm run test:server                  # tests de bout en bout sur une base en mémoire (toutes les migrations)
```

Côté site, `VITE_API_URL=http://localhost:8787` dans `.env.local`.

## Installer le VPS (une fois)

Ubuntu 24.04, en root :

```sh
# Node 22 et Caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
apt-get install -y caddy

# Compte du service et dossier
useradd --system --home /opt/travail-dur-api --shell /usr/sbin/nologin api
mkdir -p /opt/travail-dur-api && chown api: /opt/travail-dur-api

# Configuration : contenu de server/.env.example, rempli. Certificat Supabase à côté.
nano /opt/travail-dur-api/.env && chmod 600 /opt/travail-dur-api/.env && chown api: /opt/travail-dur-api/.env
# (copier supabase-ca.crt dans /opt/travail-dur-api/)

# Service et HTTPS
cp travail-dur-api.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable travail-dur-api
cp Caddyfile /etc/caddy/Caddyfile   # remplacer api.exemple.fr par ton domaine
systemctl reload caddy

# Pare-feu : seulement SSH et HTTPS
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable
```

Nom de domaine : un enregistrement DNS `A` (ex. `api.mondomaine.fr`) vers l'adresse du VPS. Sans
domaine, `api.<ip-avec-des-tirets>.sslip.io` fonctionne aussi (Caddy obtient le certificat).

### Déploiement automatique (GitHub Actions, `.github/workflows/api.yml`)

1. Sur le VPS, un compte `deploy` qui peut écrire `/opt/travail-dur-api/server.mjs` et lancer
   `sudo systemctl restart travail-dur-api` sans mot de passe (`/etc/sudoers.d/deploy`).
2. Dans GitHub → Settings → Secrets and variables → Actions :
   - secrets `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_SSH_KEY` (clé privée) ;
   - variable `VITE_API_URL` (`https://api.mondomaine.fr`), lue par le build du site.

Ensuite, chaque push sur `main` qui touche `server/` ou `shared/` teste, construit et redéploie l'API.

À la main : `npm run server:build`, copier `server/dist/server.mjs` dans `/opt/travail-dur-api/`,
puis `systemctl restart travail-dur-api`. Journal : `journalctl -u travail-dur-api -f`.
