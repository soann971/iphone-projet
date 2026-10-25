# Guide de déploiement

## 1. Lancer en local (5 minutes)

Prérequis : Docker Desktop (ou Docker Engine + Compose v2).

```bash
cd mail-support
cp .env.example .env
# Générez les deux secrets obligatoires :
sed -i.bak "s|^ENCRYPTION_KEY=$|ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
sed -i.bak "s|^SESSION_SECRET=$|SESSION_SECRET=$(openssl rand -base64 48)|" .env
# Renseignez ADMIN_EMAIL, ADMIN_PASSWORD (12 caractères min.) et ANTHROPIC_API_KEY.
docker compose up --build
```

- Dashboard : <http://localhost:3000> (connectez-vous avec `ADMIN_EMAIL`)
- API : <http://localhost:4000/health>

Puis : configurez Google Cloud (`docs/google-cloud.md`) et Shopify (`docs/shopify.md`), et
connectez la boîte depuis **Paramètres → Intégrations**.

Développement sans Docker (Node 22, pnpm 10, PostgreSQL 16, Redis 7 locaux) :

```bash
pnpm install
pnpm db:deploy && pnpm db:seed
pnpm dev:api & pnpm dev:worker & pnpm dev:dashboard
```

## 2. Démarrage progressif recommandé

1. **Semaine 1 — observation** : envoi automatique **désactivé** (par défaut). Toutes les réponses
   attendent votre validation. Corrigez, régénérez avec une consigne, complétez la **base de connaissances**.
2. **Semaine 2 — catégories sûres** : activez l'envoi automatique uniquement pour **Livraison** et
   **Commande**, seuil de confiance à 90 %.
3. **Ensuite** : élargissez catégorie par catégorie en suivant le taux de réponses modifiées dans
   **Statistiques**. Les cas sensibles restent toujours en validation humaine.

## 3. Mise en production

### Hébergement

N'importe quel serveur capable de lancer Docker Compose convient (VPS OVHcloud / Scaleway /
Hetzner, 2 vCPU et 4 Go de RAM suffisent pour quelques milliers de mails par mois). Pour un
hébergement géré : API et worker sur Cloud Run / Fly.io / Render, PostgreSQL et Redis managés.
Choisissez un hébergement **dans l'UE** (données personnelles des clients).

Pour respecter le RGPD côté IA, vérifiez les conditions de traitement des données de votre
compte Anthropic (DPA) et mentionnez ce sous-traitant dans votre politique de confidentialité.

### Nom de domaine et HTTPS

Deux sous-domaines derrière un reverse proxy TLS (Caddy, Traefik ou Nginx + Let's Encrypt) :

| Sous-domaine | Service | Public ? |
|---|---|---|
| `support.maboutique.fr` | dashboard (port 3000) — relaie `/api` et `/oauth` vers l'API | oui, protégé par mot de passe |
| `api.maboutique.fr` | API (port 4000) — **seulement** `/webhooks/*` et `/health` doivent être exposés | oui |

Exemple Caddy :

```caddy
support.maboutique.fr {
  reverse_proxy localhost:3000
}
api.maboutique.fr {
  @public path /webhooks/* /health
  handle @public {
    reverse_proxy localhost:4000
  }
  respond 404
}
```

Variables à adapter : `NODE_ENV=production` (cookies `Secure`), `APP_BASE_URL=https://api.maboutique.fr`,
`DASHBOARD_URL=https://support.maboutique.fr`, `GOOGLE_REDIRECT_URI=https://support.maboutique.fr/oauth/google/callback`.

Dans `docker-compose.yml`, ne publiez pas PostgreSQL ni Redis (c'est déjà le cas) et limitez les
ports exposés : `127.0.0.1:4000:4000` et `127.0.0.1:3000:3000` derrière le reverse proxy.

### Secrets

- Ne commitez jamais `.env`. En production, injectez les variables depuis un gestionnaire de secrets
  (Docker secrets, Doppler, Infisical, Vault, Google Secret Manager, AWS Secrets Manager…).
- `ENCRYPTION_KEY` chiffre les jetons Gmail/Shopify en base : **sauvegardez-la à part** (sans elle,
  il faut reconnecter Gmail). Rotation :
  1. placez l'ancienne clé dans `ENCRYPTION_KEY_PREVIOUS` et une nouvelle dans `ENCRYPTION_KEY` ;
  2. redémarrez, puis `pnpm cli rotate-key` (ou `docker compose exec worker node --import tsx apps/worker/src/cli.ts rotate-key`) ;
  3. retirez `ENCRYPTION_KEY_PREVIOUS`.
- Changer `SESSION_SECRET` déconnecte tous les utilisateurs.

### Sauvegardes

```bash
# Sauvegarde quotidienne de PostgreSQL (à planifier avec cron)
docker compose exec -T postgres pg_dump -U ms -Fc mail_support > backup-$(date +%F).dump
# Restauration
docker compose exec -T postgres pg_restore -U ms -d mail_support --clean < backup-AAAA-MM-JJ.dump
```

Sauvegardez aussi le volume `storage` (PDF générés). Les sauvegardes contiennent des données
personnelles : chiffrez-les et appliquez-leur la même durée de conservation.

### Mises à jour

```bash
git pull
docker compose up -d --build     # le service "migrate" applique les migrations avant le démarrage
```

### Supervision

- `GET /health` (API) : base et Redis joignables.
- Logs JSON (pino) : `docker compose logs -f api worker`. Les secrets et le contenu des mails sont masqués.
- **Paramètres → Intégrations** : état Gmail (expiration du watch), Shopify, IA, et files d'attente
  (jobs en échec, bouton « Relancer les échecs »).
- `pnpm cli status` : même information en ligne de commande.
- Alertes conseillées : jobs `failed` > 0 pendant 30 min, tickets en statut **Erreur**,
  expiration du watch Gmail dans moins de 2 jours.

## 4. Sécurité et RGPD — récapitulatif

| Exigence | Mise en œuvre |
|---|---|
| Secrets jamais en clair | `.env` / gestionnaire de secrets ; jetons OAuth chiffrés AES-256-GCM en base |
| Journal des actions | table `AuditLog` (qui, quoi, quand, IP pour les connexions) ; page **Journal** |
| Conservation configurable | **Paramètres → Conservation** ; purge automatique chaque nuit |
| Suppression d'un client | fiche client → **Droit à l'effacement** (+ webhook Shopify `customers/redact`) |
| Export d'un client | fiche client → **Exporter ses données** (JSON) |
| Injections de prompt | contenu encadré et neutralisé, l'IA n'a aucun outil d'action, garde-fou sur la réponse, détection → validation humaine |
| Accès au dashboard | comptes nominatifs, rôles, mots de passe scrypt, sessions signées, protection CSRF, limitation des tentatives de connexion |
| Webhooks | Pub/Sub : jeton OIDC Google vérifié ; Shopify : signature HMAC ; idempotence |
