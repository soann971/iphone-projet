import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "@ms/app";
import { verifyPassword } from "@ms/crypto";
import { audit } from "@ms/db";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "../auth";

const Login = z.object({ email: z.string().email(), password: z.string().min(1) });

export const authRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
      const { email, password } = Login.parse(req.body);
      const user = await ctx.db.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
        await audit(ctx.db, { actorType: "USER", action: "auth.login_failed", entityType: "User", entityId: user?.id ?? "inconnu", ip: req.ip });
        return reply.code(401).send({ error: "Identifiants incorrects" });
      }
      await ctx.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await audit(ctx.db, { actorType: "USER", actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ip: req.ip });
      reply.setCookie(SESSION_COOKIE, createSessionToken(ctx.env.SESSION_SECRET, user.id), sessionCookieOptions(ctx.env.NODE_ENV === "production"));
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    });

    app.post("/api/auth/logout", async (req, reply) => {
      if (req.user) await audit(ctx.db, { actorType: "USER", actorId: req.user.id, action: "auth.logout", entityType: "User", entityId: req.user.id });
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });

    app.get("/api/auth/me", async (req, reply) => (req.user ? req.user : reply.code(401).send({ error: "Non authentifié" })));
  };
