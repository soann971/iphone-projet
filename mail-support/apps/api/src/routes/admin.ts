import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { computeStats, disconnectGmailAccount, type AppContext } from "@ms/app";
import { hashPassword } from "@ms/crypto";
import { audit, loadSettings, saveSettings } from "@ms/db";
import { SettingsSchema } from "@ms/shared";
import { requireRole } from "../auth";

export const adminRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const viewer = { preHandler: requireRole("VIEWER") };
    const agent = { preHandler: requireRole("AGENT") };
    const admin = { preHandler: requireRole("ADMIN") };

    app.get("/api/stats", viewer, async (req) => {
      const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
      return computeStats(ctx, days);
    });

    // ---------- Paramètres ----------
    app.get("/api/settings", viewer, async () => loadSettings(ctx.db));
    app.put("/api/settings", admin, async (req) => {
      const patch = SettingsSchema.partial().parse(req.body);
      const before = await loadSettings(ctx.db);
      const after = await saveSettings(ctx.db, patch, req.user!.id);
      const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(after[k as keyof typeof after]));
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "settings.updated", entityType: "Setting", entityId: "global", details: { changed } });
      return after;
    });

    // ---------- Base de connaissances ----------
    const Knowledge = z.object({ title: z.string().min(1).max(200), content: z.string().min(1).max(5000), tags: z.array(z.string()).default([]), active: z.boolean().default(true) });
    app.get("/api/knowledge", viewer, async () => ctx.db.knowledgeEntry.findMany({ orderBy: { title: "asc" } }));
    app.post("/api/knowledge", agent, async (req) => {
      const k = await ctx.db.knowledgeEntry.create({ data: Knowledge.parse(req.body) });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "knowledge.created", entityType: "KnowledgeEntry", entityId: k.id });
      return k;
    });
    app.put("/api/knowledge/:id", agent, async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const k = await ctx.db.knowledgeEntry.update({ where: { id }, data: Knowledge.partial().parse(req.body) });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "knowledge.updated", entityType: "KnowledgeEntry", entityId: id });
      return k;
    });
    app.delete("/api/knowledge/:id", agent, async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      await ctx.db.knowledgeEntry.delete({ where: { id } });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "knowledge.deleted", entityType: "KnowledgeEntry", entityId: id });
      return { ok: true };
    });

    // ---------- Utilisateurs ----------
    app.get("/api/users", admin, async () =>
      ctx.db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, email: true, name: true, role: true, active: true, lastLoginAt: true, createdAt: true } }),
    );
    app.get("/api/users/assignable", viewer, async () => ctx.db.user.findMany({ where: { active: true, role: { not: "VIEWER" } }, select: { id: true, name: true } }));
    const NewUser = z.object({ email: z.string().email(), name: z.string().min(1), role: z.enum(["ADMIN", "AGENT", "VIEWER"]), password: z.string().min(12) });
    app.post("/api/users", admin, async (req) => {
      const u = NewUser.parse(req.body);
      const user = await ctx.db.user.create({ data: { email: u.email.toLowerCase(), name: u.name, role: u.role, passwordHash: hashPassword(u.password) } });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "user.created", entityType: "User", entityId: user.id, details: { role: u.role } });
      return { id: user.id };
    });
    app.patch("/api/users/:id", admin, async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const p = z.object({ name: z.string().min(1).optional(), role: z.enum(["ADMIN", "AGENT", "VIEWER"]).optional(), active: z.boolean().optional(), password: z.string().min(12).optional() }).parse(req.body);
      if (id === req.user!.id && (p.active === false || (p.role && p.role !== "ADMIN"))) {
        return reply.code(400).send({ error: "Vous ne pouvez pas retirer vos propres droits d'administrateur" });
      }
      await ctx.db.user.update({
        where: { id },
        data: { name: p.name, role: p.role, active: p.active, ...(p.password ? { passwordHash: hashPassword(p.password) } : {}) },
      });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "user.updated", entityType: "User", entityId: id, details: { fields: Object.keys(p).filter((k) => k !== "password"), passwordChanged: !!p.password } });
      return { ok: true };
    });

    // ---------- Journal d'audit ----------
    app.get("/api/audit", admin, async (req) => {
      const q = z.object({ action: z.string().optional(), entityId: z.string().optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
      const where = { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) };
      const [total, items] = await Promise.all([
        ctx.db.auditLog.count({ where }),
        ctx.db.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (q.page - 1) * 50, take: 50 }),
      ]);
      const users = await ctx.db.user.findMany({ select: { id: true, name: true } });
      const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
      return { total, page: q.page, items: items.map((i) => ({ ...i, actorName: i.actorId ? (names[i.actorId] ?? null) : null })) };
    });

    // ---------- Intégrations et files ----------
    app.get("/api/integrations", viewer, async () => {
      const accounts = await ctx.db.gmailAccount.findMany({ select: { id: true, email: true, active: true, watchExpiresAt: true, lastSyncAt: true, createdAt: true } });
      const queues = await Promise.all(ctx.queues.all().map(async (q) => ({ name: q.name, counts: await q.getJobCounts("waiting", "active", "delayed", "failed", "completed") })));
      let shopify: { configured: boolean; ok?: boolean; shop?: string; error?: string } = { configured: !!ctx.shopify };
      if (ctx.shopify) {
        try {
          const info = await ctx.shopify.shopInfo();
          shopify = { configured: true, ok: true, shop: info.name };
        } catch (err) {
          shopify = { configured: true, ok: false, error: (err as Error).message };
        }
      }
      return {
        gmail: { configured: !!ctx.google.clientId, pubsub: !!ctx.env.GMAIL_PUBSUB_TOPIC, accounts },
        shopify,
        ai: { configured: !!ctx.env.ANTHROPIC_API_KEY, model: ctx.env.AI_MODEL },
        carriers: { laposte: !!ctx.env.LAPOSTE_API_KEY, seventeenTrack: !!ctx.env.SEVENTEENTRACK_API_KEY },
        queues,
      };
    });

    app.get("/api/queues/:name/failed", admin, async (req, reply) => {
      const { name } = z.object({ name: z.string() }).parse(req.params);
      const q = ctx.queues.all().find((x) => x.name === name);
      if (!q) return reply.code(404).send({ error: "File inconnue" });
      const jobs = await q.getFailed(0, 49);
      return jobs.map((j) => ({ id: j.id, name: j.name, data: j.data, failedReason: j.failedReason, attemptsMade: j.attemptsMade, finishedOn: j.finishedOn }));
    });

    app.post("/api/queues/:name/retry", admin, async (req, reply) => {
      const { name } = z.object({ name: z.string() }).parse(req.params);
      const q = ctx.queues.all().find((x) => x.name === name);
      if (!q) return reply.code(404).send({ error: "File inconnue" });
      await q.retryJobs({ state: "failed" });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "queue.retry_failed", entityType: "Queue", entityId: name });
      return { ok: true };
    });

    app.post("/api/gmail/sync", admin, async (req) => {
      const accounts = await ctx.db.gmailAccount.findMany({ where: { active: true } });
      for (const a of accounts) await ctx.queues.enqueueSync(a.id);
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "gmail.sync_requested", entityType: "GmailAccount", entityId: "all" });
      return { ok: true, accounts: accounts.length };
    });

    app.delete("/api/gmail/:id", admin, async (req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      await disconnectGmailAccount(ctx, id, req.user!.id);
      return { ok: true };
    });
  };
