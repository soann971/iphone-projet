import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/**
 * Variables d'environnement. Les secrets ne vivent QUE dans l'environnement
 * (fichier .env en local, gestionnaire de secrets en production) ou chiffrés en base.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  API_PORT: z.coerce.number().default(4000),
  /** URL publique de l'API (callbacks OAuth, webhooks). */
  APP_BASE_URL: z.string().url().default("http://localhost:4000"),
  DASHBOARD_URL: z.string().url().default("http://localhost:3000"),

  /** Clé maître AES-256 (32 octets en base64). `openssl rand -base64 32` */
  ENCRYPTION_KEY: z.string().min(40),
  /** Ancienne clé, uniquement pendant une rotation. */
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  /** Secret de signature des sessions du dashboard. */
  SESSION_SECRET: z.string().min(32),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:4000/oauth/google/callback"),
  /** projects/<projet>/topics/<topic> */
  GMAIL_PUBSUB_TOPIC: z.string().default(""),
  /** Audience attendue dans le jeton OIDC des push Pub/Sub (souvent l'URL du webhook). */
  PUBSUB_AUDIENCE: z.string().default(""),
  /** Compte de service autorisé à pousser vers le webhook. */
  PUBSUB_SERVICE_ACCOUNT: z.string().default(""),
  /** Désactive la vérification OIDC (développement local uniquement). */
  PUBSUB_SKIP_VERIFY: bool.default(false),

  ANTHROPIC_API_KEY: z.string().default(""),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_EFFORT_CLASSIFY: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  AI_EFFORT_DRAFT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  /** Active le repli automatique côté serveur si le modèle refuse une requête. */
  AI_FALLBACKS: bool.default(true),

  SHOPIFY_STORE_DOMAIN: z.string().default(""),
  SHOPIFY_CLIENT_ID: z.string().default(""),
  SHOPIFY_CLIENT_SECRET: z.string().default(""),
  /** Jeton d'une ancienne "custom app" (shpat_…), si vous en avez une. Prioritaire. */
  SHOPIFY_ADMIN_TOKEN: z.string().default(""),
  SHOPIFY_API_VERSION: z.string().default("2026-10"),
  /** Secret de signature des webhooks (par défaut : SHOPIFY_CLIENT_SECRET). */
  SHOPIFY_WEBHOOK_SECRET: z.string().default(""),

  LAPOSTE_API_KEY: z.string().default(""),
  SEVENTEENTRACK_API_KEY: z.string().default(""),

  STORAGE_DIR: z.string().default("./storage"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Réinitialise le cache (tests). */
export function resetEnvCache() {
  cached = undefined;
}
