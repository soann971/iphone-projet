# Image unique pour l'API et le worker (le service lancé dépend de la commande).
# Le code TypeScript est exécuté par tsx : pas d'étape de bundling fragile (Prisma, ESM).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN npm install -g pnpm@10.28.0 && apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/ai/package.json packages/ai/
COPY packages/app/package.json packages/app/
COPY packages/core/package.json packages/core/
COPY packages/crypto/package.json packages/crypto/
COPY packages/db/package.json packages/db/
COPY packages/gmail/package.json packages/gmail/
COPY packages/integrations/package.json packages/integrations/
COPY packages/pdf/package.json packages/pdf/
COPY packages/shared/package.json packages/shared/
# Les sources Prisma sont nécessaires au postinstall (prisma generate).
COPY packages/db/prisma packages/db/prisma
COPY packages/db/prisma.config.ts packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "!@ms/dashboard" --prod=false

FROM base AS runtime
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN pnpm --filter @ms/db generate && mkdir -p /app/storage && chown -R node:node /app/storage
USER node
ENV STORAGE_DIR=/app/storage
EXPOSE 4000
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
