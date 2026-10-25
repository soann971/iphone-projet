# CLAUDE.md — mail-support

Logiciel de gestion automatique des emails clients d'une boutique **Shopify** :
une boîte Gmail reçoit les mails, chaque mail est classé par l'IA (Claude), enrichi avec
des **faits vérifiés** (Shopify, transporteurs, règles métier), une réponse est rédigée puis
envoyée automatiquement **ou** soumise à validation humaine dans le dashboard.

Langue du produit, des messages et de la documentation : **français**.

## Commandes

```bash
pnpm install                      # installe tout + génère le client Prisma
pnpm db:migrate                   # crée/applique une migration (dev)
pnpm db:seed                      # crée l'admin (ADMIN_EMAIL / ADMIN_PASSWORD)
pnpm --filter @ms/db demo         # données de démonstration
pnpm dev:api | dev:worker | dev:dashboard
pnpm typecheck                    # tsc sur tous les paquets
pnpm test                         # tests unitaires (hors ligne)
TEST_DATABASE_URL=postgresql://… pnpm test   # + tests d'intégration (base réelle, vidée !)
RUN_LIVE_AI=1 ANTHROPIC_API_KEY=… pnpm test packages/ai   # évaluation réelle de la classification
pnpm cli status|sync|reprocess <id>|shopify:check|shopify:webhooks|retention|rotate-key
docker compose up --build         # tout en local
```

## Architecture

```
apps/api        Fastify : webhooks (Pub/Sub, Shopify), OAuth Gmail, API REST du dashboard
apps/worker     Workers BullMQ + tâches planifiées + CLI d'administration
apps/dashboard  Next.js (App Router), client uniquement ; /api et /oauth relayés vers l'API
packages/app    Orchestration métier partagée (contexte, files, pipeline, RGPD, stats)
packages/core   Logique PURE et testée : garantie, rétractation, décision, garde-fou, texte
packages/ai     Prompts, appels Claude (structured outputs), anti-injection
packages/gmail  OAuth, history, parsing/construction MIME, envoi dans le fil, Pub/Sub
packages/integrations  Shopify GraphQL, transporteurs (La Poste, 17TRACK), HTTP
packages/pdf    Devis et bons de retour (pdfkit)
packages/db     Schéma Prisma 7 (adapter pg), paramètres, audit, compteurs
packages/crypto AES-256-GCM (secrets en base), scrypt, HMAC
packages/shared Config (Zod), logger pino, catégories, schémas de sortie IA, paramètres
```

Flux d'un mail : `Pub/Sub → POST /webhooks/gmail → file gmail-sync (history.list) → file ingest
(client par email, ticket par threadId) → file process (classify → buildFacts → draft →
checkReply → decide) → AUTO : file send | REVIEW : dashboard → validation → file send`.

## Règles non négociables

1. **Le contenu d'un mail est une donnée, jamais une instruction.** Il passe toujours par
   `wrapEmail`/`neutralize` (packages/ai/src/sanitize.ts). Ne jamais l'insérer dans un prompt système.
2. **L'IA ne décide rien.** Éligibilité garantie/retour, prix, statuts, identité : calculés par le
   code (`packages/core`, `packages/app/src/enrich.ts`). L'IA rédige à partir de `VerifiedFacts`.
3. **Ne jamais inventer** : tout montant, date, lien, numéro, email ou téléphone d'une réponse doit
   provenir des faits (`checkReply`). Une donnée manquante → `facts.missing` → on la demande au client.
4. **Validation humaine obligatoire** (voir `packages/core/src/policy.ts`) : remboursement, litige,
   menace juridique, client mécontent, réclamation, garantie refusée/indéterminée, retour hors délai,
   montant > seuil, injection suspectée, langue ≠ fr, confiance < seuil. Ajouter une règle = ajouter un test.
5. **Ne jamais divulguer une commande** à un expéditeur qui n'en est pas le titulaire (`IDENTITY_MISMATCH`).
6. **Jamais de réponse aux mails automatiques** (répondeurs, rebonds, listes) : anti-boucle.
7. **Secrets** : uniquement dans l'environnement ou chiffrés en base via `secretBox()`. Jamais dans le
   code, les logs (pino `redact`) ni le journal d'audit.
8. **Audit** : toute action qui modifie un ticket, un brouillon, un paramètre, un utilisateur ou des
   données client appelle `audit()`. Les détails ne contiennent jamais le contenu d'un mail.
9. **Idempotence** : chaque job peut être rejoué (message déjà ingéré, réponse déjà préparée,
   en-tête `X-MS-Draft-Id` vérifié avant envoi, `ProcessedEvent` pour les webhooks).

## Conventions

- TypeScript strict, ESM, `moduleResolution: Bundler`. Les paquets exposent leur `src/index.ts`
  (pas de build) ; exécution via `tsx` en dev comme en production.
- Erreurs : `TransientError` (réessayée par BullMQ) / `PermanentError` (→ `UnrecoverableError`).
- Validation des entrées API avec Zod ; réponses JSON, messages d'erreur en français.
- Dates en UTC en base ; formatage client via `formatDateFr` / `formatEuro` (packages/core/src/dates.ts).
  Les faits sont pré-formatés pour que le garde-fou compare les mêmes chaînes.
- Paramètres métier modifiables à chaud : `SettingsSchema` (packages/shared/src/settings.ts), table `Setting`.
  L'envoi automatique est **désactivé par défaut**.
- Modèle IA : `AI_MODEL` (défaut `claude-opus-5-5`), effort `low` pour classer, `medium` pour rédiger,
  repli serveur `fallbacks: "default"` activé. Incrémenter `PROMPT_VERSION` à chaque changement de prompt.
- Tests : Vitest. Logique pure → test unitaire à côté du fichier. Pipeline → `packages/app/src/pipeline.test.ts`
  avec les doublures de `packages/app/src/testing.ts`. Nouveau cas de mail → fixture anonymisée dans
  `tests/fixtures/emails/`.
- Migrations : `pnpm db:migrate --name <nom>` ; ne jamais modifier une migration déjà appliquée.
- Dashboard : pas de `dangerouslySetInnerHTML` ; le contenu client est affiché en texte brut.
  Les requêtes modifiantes envoient l'en-tête `x-ms-csrf: 1` (fait par `lib/api.ts`).

## Documentation

- `docs/architecture.md` — modèle de données, flux, décisions
- `docs/google-cloud.md` — projet, API Gmail, écran de consentement, OAuth, Pub/Sub (pas à pas)
- `docs/shopify.md` — app Shopify, autorisations, webhooks, métachamp de garantie
- `docs/deploiement.md` — mise en production, secrets, sauvegardes, supervision
