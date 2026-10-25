# Connecter Shopify — pas à pas

Le logiciel interroge Shopify pour **identifier le client**, **retrouver ses commandes**, connaître
les **expéditions et numéros de suivi**, calculer **garantie et délai de rétractation**, chiffrer les
**devis** au prix du catalogue (avec commande provisoire et lien de paiement) et créer les **retours**.
Il n'effectue **aucun remboursement**.

> Depuis le 1er janvier 2026, on ne crée plus d'« app personnalisée » depuis l'admin de la boutique.
> On crée une app dans le **Dev Dashboard** de Shopify, et le logiciel obtient un jeton d'accès
> (valable 24 h, renouvelé automatiquement) avec l'identifiant et le secret de l'app.
> Si vous avez déjà une ancienne app personnalisée avec un jeton `shpat_…`, renseignez simplement
> `SHOPIFY_ADMIN_TOKEN` et passez à l'étape 4.

## Étape 1 — Créer l'application

1. Ouvrez le Dev Dashboard : <https://dev.shopify.com/dashboard> (connectez-vous avec le compte
   propriétaire ou un collaborateur de la boutique).
2. **Create app** → *Start from Dev Dashboard* → nom : `Service client mails`.
3. L'application et la boutique doivent appartenir à la **même organisation** Shopify (sinon le
   jeton est refusé : « Client credentials cannot be performed on this shop »).

## Étape 2 — Autorisations (scopes)

Dans l'app → **Versions → Create version** (ou *Configuration*), section **Access / Scopes** :

| Scope | Usage |
|---|---|
| `read_customers` | identifier le client par son email |
| `read_orders` | commandes, montants, statuts |
| `read_all_orders` | commandes de plus de 60 jours (**indispensable pour les garanties**) |
| `read_fulfillments` | expéditions, numéros de suivi, dates de livraison |
| `read_products` | catalogue et prix pour les devis, métachamp de garantie |
| `write_draft_orders` | devis : commande provisoire + lien de paiement (facultatif) |
| `read_returns`, `write_returns` | création des demandes de retour (facultatif) |

Si vous désactivez les options correspondantes dans **Paramètres** du dashboard, les deux derniers
groupes ne sont pas nécessaires.

**Données client protégées** : dans l'app → *API access requests* → **Protected customer data** :
déclarez l'usage « service client » et demandez l'accès aux champs **Nom** et **Email**.
Sans cela, Shopify masque l'email des commandes et le rapprochement mail ↔ commande échoue.

Publiez la version (**Release**).

## Étape 3 — Installer l'app sur la boutique

Dans l'app → **Home / Overview → Install app** → choisissez votre boutique → acceptez les autorisations.

Récupérez dans **Settings** de l'app : **Client ID** et **Client secret**. Dans `.env` :

```ini
SHOPIFY_STORE_DOMAIN=ma-boutique.myshopify.com
SHOPIFY_CLIENT_ID=xxxxxxxxxxxxxxxx
SHOPIFY_CLIENT_SECRET=xxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2026-10
```

Vérification :

```bash
pnpm cli shopify:check        # affiche le nom de la boutique
```

## Étape 4 — Webhooks (mise à jour en temps réel des commandes)

L'API doit être joignable en HTTPS (`APP_BASE_URL`). Puis :

```bash
pnpm cli shopify:webhooks
```

Cela abonne l'app à `orders/create`, `orders/updated`, `fulfillments/create`, `fulfillments/update`
vers `APP_BASE_URL/webhooks/shopify`. Chaque webhook est **vérifié par signature HMAC** et
**dédupliqué**. (Les webhooks ne sont qu'un cache : sans eux, le logiciel interroge Shopify à chaque mail.)

**Webhooks RGPD** (`customers/redact`, `customers/data_request`, `shop/redact`) : déclarez dans la
configuration de l'app l'URL `APP_BASE_URL/webhooks/shopify` pour les *compliance webhooks*.
Une demande `customers/redact` efface le client dans le logiciel.

## Étape 5 — Durée de garantie par produit (facultatif)

Par défaut, la garantie vaut **24 mois** (modifiable dans **Paramètres**). Pour une durée différente
par produit (ex. 12 mois sur le reconditionné) :

1. Admin Shopify → **Paramètres → Données personnalisées → Produits → Ajouter une définition**.
2. Nom : `Garantie (mois)` · Espace de noms et clé : **`custom.warranty_months`** · Type : **Nombre entier**.
3. Renseignez la valeur sur chaque fiche produit.

## Comment les données Shopify sont utilisées

- **Identification** : l'expéditeur du mail est recherché comme client Shopify (par email).
- **Commande** : le numéro cité (#1234) est cherché **parmi les commandes de l'expéditeur**. S'il
  appartient à un autre client, **rien n'est divulgué** et le ticket passe en validation.
- **Suivi** : statut Shopify ; si la livraison n'est pas confirmée, API La Poste (Colissimo,
  Chronopost) ou 17TRACK (autres transporteurs) si les clés sont configurées.
- **Rétractation** : 14 jours à compter de la **livraison** (date Shopify ou transporteur). Si elle
  est inconnue et que la commande a plus de 14 jours, un humain vérifie (on ne refuse jamais sur une estimation).
- **Devis** : chaque produit demandé doit correspondre à **une seule** variante active du catalogue,
  sinon le devis est préparé par un humain. Le PDF reprend les prix TTC Shopify.
- **Retours** : quand la procédure de retour est envoyée au client, une demande de retour est créée
  dans Shopify (statut « demandé ») ; vous la traitez ensuite dans l'admin Shopify comme d'habitude.
