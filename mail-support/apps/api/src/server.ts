import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { AppContext } from "@ms/app";
import { logger } from "@ms/shared";
import { ZodError } from "zod";
import { readSessionToken, SESSION_COOKIE } from "./auth";
import { authRoutes } from "./routes/auth";
import { webhookRoutes } from "./routes/webhooks";
import { oauthRoutes } from "./routes/oauth";
import { ticketRoutes } from "./routes/tickets";
import { customerRoutes } from "./routes/customers";
import { adminRoutes } from "./routes/admin";

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  // BigInt (journal d'audit) et Decimal (montants) sérialisés proprement.
  app.setReplySerializer((payload) => JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie, { secret: ctx.env.SESSION_SECRET });
  await app.register(rateLimit, { global: false });

  // Session : on relit l'utilisateur en base (désactivation et changement de rôle immédiats).
  app.addHook("onRequest", async (req) => {
    const uid = readSessionToken(ctx.env.SESSION_SECRET, req.cookies[SESSION_COOKIE]);
    if (!uid) return;
    const u = await ctx.db.user.findUnique({ where: { id: uid } });
    if (u?.active) req.user = { id: u.id, email: u.email, name: u.name, role: u.role };
  });

  // Protection CSRF : toute requête modifiante de l'API doit porter un en-tête personnalisé
  // (impossible à envoyer depuis un autre site sans CORS, que l'API n'autorise pas).
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-ms-csrf"] !== "1") {
      return reply.code(403).send({ error: "En-tête CSRF manquant" });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "Requête invalide", details: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "erreur serveur");
    return reply.code(status).send({ error: status >= 500 ? "Erreur interne" : (err as Error).message });
  });

  app.get("/health", async () => {
    await ctx.db.$queryRaw`SELECT 1`;
    await ctx.queues.connection.ping();
    return { status: "ok" };
  });

  await app.register(webhookRoutes(ctx));
  await app.register(oauthRoutes(ctx));
  await app.register(authRoutes(ctx));
  await app.register(ticketRoutes(ctx));
  await app.register(customerRoutes(ctx));
  await app.register(adminRoutes(ctx));
  return app;
}
