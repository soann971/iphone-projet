# mail-support — gestion automatique des emails clients (Gmail + Shopify + Claude)

Chaque mail reçu sur la boîte du service client est **lu, classé, enrichi, répondu** :

1. **Réception en temps réel** (Gmail API + Pub/Sub) ; un fil Gmail = un ticket, un email = un client.
2. **Classification par l'IA** (Claude) en 8 catégories : information, commande, devis, garantie,
   retour, SAV, livraison, spam ; extraction des numéros de commande, produits, n° de série…
3. **Faits vérifiés** : commande Shopify (titulaire contrôlé), suivi colis (Shopify, La Poste, 17TRACK),
   garantie (date d'achat + durée par produit), rétractation 14 jours après livraison, devis au prix
   du catalogue avec **PDF** et lien de paiement, **bon de retour PDF**.
4. **Réponse rédigée** à partir de ces seuls faits (ton professionnel et chaleureux, signature personnalisable).
5. **Envoi automatique** au-dessus d'un seuil de confiance, sinon **validation humaine** dans le dashboard.
   Toujours validés par un humain : remboursements, litiges, garanties refusées, clients mécontents,
   montants élevés, tentatives de manipulation.

![Architecture](docs/architecture.md)

## Démarrer

```bash
cp .env.example .env      # puis complétez (voir commentaires)
docker compose up --build # dashboard : http://localhost:3000
```

| Guide | Contenu |
|---|---|
| [docs/google-cloud.md](docs/google-cloud.md) | Projet Google Cloud, API Gmail, écran de consentement OAuth, Pub/Sub — pas à pas |
| [docs/shopify.md](docs/shopify.md) | App Shopify (Dev Dashboard), autorisations, webhooks, garantie par produit |
| [docs/deploiement.md](docs/deploiement.md) | Local, production, HTTPS, secrets, sauvegardes, supervision, RGPD |
| [docs/architecture.md](docs/architecture.md) | Flux, files d'attente, modèle de données, moteur de décision, sécurité |
| [CLAUDE.md](CLAUDE.md) | Conventions du projet |

## Tests

```bash
pnpm test                                                   # unitaires
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/test pnpm test   # + intégration (base vidée !)
RUN_LIVE_AI=1 ANTHROPIC_API_KEY=sk-ant-… pnpm test packages/ai          # classification réelle sur les mails anonymisés
```

Les mails d'exemple anonymisés sont dans `tests/fixtures/emails/` : ajoutez-y vos propres cas
(anonymisés) pour mesurer la qualité de la classification.
