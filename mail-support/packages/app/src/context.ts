import { ClaudeProvider, type AiProvider } from "@ms/ai";
import { getDb, loadSettings, secretBox, type Db } from "@ms/db";
import { GmailService, type GoogleOAuthConfig } from "@ms/gmail";
import {
  LaPosteTracker,
  SeventeenTrackTracker,
  ShopifyClient,
  isShopifyConfigured,
  type CarrierTracker,
  type TokenStore,
} from "@ms/integrations";
import { loadEnv, PermanentError, type Env, type Settings } from "@ms/shared";
import { Queues, createRedis } from "./queues";
import { FileStorage } from "./storage";

/** Dépendances partagées par le worker et l'API. Tout est injectable pour les tests. */
export interface AppContext {
  env: Env;
  db: Db;
  queues: Queues;
  ai: AiProvider;
  shopify: ShopifyClient | null;
  trackers: CarrierTracker[];
  storage: FileStorage;
  google: GoogleOAuthConfig;
  settings(): Promise<Settings>;
  gmail(accountId: string): Promise<{ service: GmailService; email: string; labelIds: Record<string, string> }>;
  now(): Date;
}

/** Jeton Shopify chiffré en base (partagé entre processus). */
function shopifyTokenStore(db: Db): TokenStore {
  return {
    async get() {
      const row = await db.integrationCredential.findUnique({ where: { provider: "shopify" } });
      if (!row?.expiresAt || !row.encryptedData) return null;
      try {
        return { token: secretBox().decrypt(row.encryptedData), expiresAt: row.expiresAt };
      } catch {
        return null;
      }
    },
    async set(token, expiresAt) {
      const encryptedData = token ? secretBox().encrypt(token) : "";
      await db.integrationCredential.upsert({
        where: { provider: "shopify" },
        create: { provider: "shopify", encryptedData, expiresAt },
        update: { encryptedData, expiresAt },
      });
    },
  };
}

export function createContext(env: Env = loadEnv()): AppContext {
  const db = getDb(env.DATABASE_URL);
  const google: GoogleOAuthConfig = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
  const shopifyCfg = {
    storeDomain: env.SHOPIFY_STORE_DOMAIN,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
    adminToken: env.SHOPIFY_ADMIN_TOKEN || undefined,
    apiVersion: env.SHOPIFY_API_VERSION,
  };
  const gmailCache = new Map<string, { service: GmailService; refreshToken: string }>();

  let settingsCache: { at: number; value: Settings } | null = null;

  return {
    env,
    db,
    queues: new Queues(createRedis(env.REDIS_URL)),
    ai: new ClaudeProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL,
      classifyEffort: env.AI_EFFORT_CLASSIFY,
      draftEffort: env.AI_EFFORT_DRAFT,
      fallbacks: env.AI_FALLBACKS,
    }),
    shopify: isShopifyConfigured(shopifyCfg) ? new ShopifyClient(shopifyCfg, shopifyTokenStore(db)) : null,
    trackers: [new LaPosteTracker(env.LAPOSTE_API_KEY), new SeventeenTrackTracker(env.SEVENTEENTRACK_API_KEY)],
    storage: new FileStorage(env.STORAGE_DIR),
    google,
    async settings() {
      // Cache court : les modifications du dashboard sont prises en compte en moins de 10 s.
      if (settingsCache && Date.now() - settingsCache.at < 10_000) return settingsCache.value;
      const value = await loadSettings(db);
      settingsCache = { at: Date.now(), value };
      return value;
    },
    async gmail(accountId) {
      const account = await db.gmailAccount.findUnique({ where: { id: accountId } });
      if (!account || !account.active) throw new PermanentError(`Boîte Gmail ${accountId} inactive ou inconnue`);
      const refreshToken = secretBox().decrypt(account.encryptedRefreshToken);
      let cached = gmailCache.get(accountId);
      if (!cached || cached.refreshToken !== refreshToken) {
        cached = { service: new GmailService(google, refreshToken), refreshToken };
        gmailCache.set(accountId, cached);
      }
      return { service: cached.service, email: account.email, labelIds: account.labelIds as Record<string, string> };
    },
    now: () => new Date(),
  };
}
