# Configurer Google Cloud (Gmail API, OAuth, Pub/Sub) — pas à pas

Objectif : permettre au logiciel de **lire** et **envoyer** les mails de la boîte du service client,
et d'être **prévenu en temps réel** de chaque nouveau mail.

Durée : 30 à 45 minutes. Les menus de la console Google changent souvent de nom : si un intitulé
diffère, utilisez la barre de recherche en haut de la console.

> **Gmail perso ou Google Workspace ?**
> - **Google Workspace** (adresse @votre-domaine.fr gérée par Google) : **recommandé**. L'application
>   peut être déclarée **Interne** : aucune validation Google n'est nécessaire.
> - **Compte @gmail.com** : l'application est forcément **Externe**. La portée Gmail utilisée est
>   « restreinte » : en mode **Test**, l'autorisation expire au bout de **7 jours** (il faut se
>   reconnecter chaque semaine) ; pour passer en **Production**, Google exige une vérification de
>   l'application avec une évaluation de sécurité tierce (payante). Pour un usage durable,
>   passez la boîte support sur Google Workspace.

---

## Étape 1 — Créer le projet

1. Ouvrez <https://console.cloud.google.com/> avec le compte **administrateur** (pas forcément la boîte support).
2. En haut, sélecteur de projet → **Nouveau projet**.
   - Nom : `service-client-mails` (exemple)
   - Organisation : votre domaine Workspace si proposé.
3. Notez l'**ID du projet** (ex. `service-client-mails-123456`) : il sert plus loin (`PROJECT_ID`).

Facultatif mais pratique : installez la CLI `gcloud` (<https://cloud.google.com/sdk/docs/install>), puis :

```bash
gcloud auth login
gcloud config set project PROJECT_ID
```

## Étape 2 — Activer les API

Console : **API et services → Bibliothèque**, puis activez :
- **Gmail API**
- **Cloud Pub/Sub API**

Ou en ligne de commande :

```bash
gcloud services enable gmail.googleapis.com pubsub.googleapis.com
```

## Étape 3 — Écran de consentement OAuth (« Google Auth Platform »)

Console : **API et services → Écran de consentement OAuth** (ou **Google Auth Platform**).

1. **Branding** (Informations sur l'application)
   - Nom de l'application : `Service client – Ma Boutique`
   - Adresse email d'assistance : votre adresse
   - Domaine autorisé : le domaine où sera hébergé le dashboard (ex. `maboutique.fr`)
   - Coordonnées du développeur : votre adresse
2. **Audience** (Type d'utilisateur)
   - **Interne** si Google Workspace (recommandé).
   - Sinon **Externe**, puis ajoutez l'adresse de la boîte support dans **Utilisateurs test**.
3. **Accès aux données** (Champs d'application) → **Ajouter** :
   - `https://www.googleapis.com/auth/gmail.modify` — lire, libeller, archiver et **envoyer**
     (sans suppression définitive)
   - `openid` et `.../auth/userinfo.email` — connaître l'adresse de la boîte connectée

Pourquoi `gmail.modify` et pas `gmail.readonly` + `gmail.send` ? Le logiciel doit aussi
**appliquer des libellés** (« Support/Garantie », « Support/À valider »…) et **archiver** le spam.

## Étape 4 — Identifiants OAuth (client « Application Web »)

Console : **API et services → Identifiants → Créer des identifiants → ID client OAuth**
(ou **Google Auth Platform → Clients → Créer un client**).

- Type : **Application Web**
- Nom : `mail-support`
- **URI de redirection autorisés** : l'URL du **dashboard** suivie de `/oauth/google/callback`
  - en local : `http://localhost:3000/oauth/google/callback`
  - en production : `https://support.maboutique.fr/oauth/google/callback`

Récupérez l'**ID client** et le **code secret**, puis dans `.env` :

```ini
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
GOOGLE_REDIRECT_URI=https://support.maboutique.fr/oauth/google/callback
```

> Le code secret est un secret : ne le collez jamais dans le code ni dans un ticket.

## Étape 5 — Pub/Sub : le sujet (topic) qui reçoit les notifications Gmail

```bash
# 1. Créer le sujet
gcloud pubsub topics create gmail-notifications

# 2. Autoriser Gmail à y publier (compte de service géré par Google, à saisir tel quel)
gcloud pubsub topics add-iam-policy-binding gmail-notifications \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

Dans la console : **Pub/Sub → Sujets → Créer un sujet** (`gmail-notifications`), puis dans le
sujet → **Autorisations → Ajouter un compte principal** : `gmail-api-push@system.gserviceaccount.com`,
rôle **Diffuseur Pub/Sub** (*Pub/Sub Publisher*).

> Si votre organisation applique la règle « Partage restreint au domaine », l'ajout de ce compte
> peut être bloqué : un administrateur doit autoriser une exception pour ce projet.

Dans `.env` :

```ini
GMAIL_PUBSUB_TOPIC=projects/PROJECT_ID/topics/gmail-notifications
```

## Étape 6 — Pub/Sub : l'abonnement « push » authentifié vers l'API

Pub/Sub va appeler `https://VOTRE-API/webhooks/gmail` à chaque notification. L'appel porte un
**jeton signé par Google** (OIDC) que l'API vérifie : personne d'autre ne peut déclencher de faux appels.

```bash
# 1. Compte de service dédié aux appels push
gcloud iam service-accounts create pubsub-push --display-name="Pub/Sub push mail-support"

# 2. Permettre à Pub/Sub de signer des jetons pour ce compte
PROJECT_NUMBER=$(gcloud projects describe PROJECT_ID --format="value(projectNumber)")
gcloud iam service-accounts add-iam-policy-binding \
  pubsub-push@PROJECT_ID.iam.gserviceaccount.com \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# 3. L'abonnement push (URL publique HTTPS de l'API)
gcloud pubsub subscriptions create gmail-push \
  --topic=gmail-notifications \
  --push-endpoint="https://api.maboutique.fr/webhooks/gmail" \
  --push-auth-service-account="pubsub-push@PROJECT_ID.iam.gserviceaccount.com" \
  --push-auth-token-audience="https://api.maboutique.fr/webhooks/gmail" \
  --ack-deadline=30 \
  --message-retention-duration=1d
```

Dans `.env` :

```ini
PUBSUB_SERVICE_ACCOUNT=pubsub-push@PROJECT_ID.iam.gserviceaccount.com
PUBSUB_AUDIENCE=https://api.maboutique.fr/webhooks/gmail
APP_BASE_URL=https://api.maboutique.fr
```

> **En local**, Pub/Sub ne peut pas joindre `localhost`. Deux options :
> 1. Ne rien configurer : le worker **relève la boîte toutes les 10 minutes** (rattrapage automatique).
>    Le bouton « Synchroniser maintenant » du dashboard force une relève immédiate.
> 2. Exposer l'API avec un tunnel HTTPS (ex. `cloudflared tunnel --url http://localhost:4000`)
>    et utiliser l'URL du tunnel dans l'abonnement.

## Étape 7 — Connecter la boîte support

1. Démarrez le logiciel (`docker compose up --build`).
2. Connectez-vous au dashboard avec le compte administrateur.
3. **Paramètres → Intégrations → Connecter la boîte Gmail**.
4. Choisissez **le compte de la boîte support** et acceptez les autorisations.

Le logiciel alors :
- enregistre le jeton d'actualisation **chiffré** (AES-256-GCM) en base ;
- crée les libellés `Support/Information`, `Support/Commande`, `Support/Devis`, `Support/Garantie`,
  `Support/Retour`, `Support/SAV`, `Support/Livraison`, `Support/Spam`, `Support/À valider`,
  `Support/Réponse auto`, `Support/Traité` ;
- active la surveillance (`users.watch`) sur la boîte de réception. Elle expire au bout de 7 jours :
  le worker la **renouvelle chaque nuit**.

Vérification : `pnpm cli status` (ou **Paramètres → Intégrations**) affiche la date d'expiration
des notifications et la dernière synchronisation. Envoyez un mail de test à la boîte support :
il apparaît dans **Tickets** en quelques secondes.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Google n'a pas renvoyé de refresh token » | Autorisation déjà accordée auparavant | <https://myaccount.google.com/permissions> → retirer l'app → reconnecter |
| `invalid_grant` dans les logs, boîte inactive | Mot de passe changé, accès révoqué, ou app en mode Test (7 jours) | Reconnecter la boîte ; passer en Interne / Production |
| `redirect_uri_mismatch` | URI de redirection différente | L'URI déclarée doit être **exactement** `GOOGLE_REDIRECT_URI` |
| Aucun mail n'arrive en temps réel | Abonnement push mal configuré | Console Pub/Sub → abonnement → onglet *Métriques* ; logs API « push Pub/Sub refusé » ; vérifier `PUBSUB_AUDIENCE` et `PUBSUB_SERVICE_ACCOUNT` |
| `User not authorized to perform this action` au `watch` | Gmail ne peut pas publier dans le sujet | Refaire l'étape 5, point 2 |
| Les mails arrivent avec 10 min de retard | Pas de Pub/Sub (relève périodique uniquement) | Configurer les étapes 5 et 6 |
