import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { eraseCustomer, exportCustomer, type AppContext } from "@ms/app";
import { requireRole } from "../auth";

export const customerRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.get("/api/customers", { preHandler: requireRole("VIEWER") }, async (req) => {
      const { q, page } = z.object({ q: z.string().max(200).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
      const where = q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : {};
      const [total, items] = await Promise.all([
        ctx.db.customer.count({ where }),
        ctx.db.customer.findMany({ where, orderBy: { lastContactAt: "desc" }, skip: (page - 1) * 25, take: 25, include: { _count: { select: { tickets: true, orders: true } } } }),
      ]);
      return { total, page, items };
    });

    app.get("/api/customers/:id", { preHandler: requireRole("VIEWER") }, async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const c = await ctx.db.customer.findUnique({
        where: { id },
        include: {
          tickets: { orderBy: { lastMessageAt: "desc" }, select: { id: true, number: true, subject: true, status: true, category: true, lastMessageAt: true } },
          orders: { orderBy: { orderedAt: "desc" }, include: { shipments: true } },
        },
      });
      return c ?? reply.code(404).send({ error: "Client introuvable" });
    });

    /** Export RGPD (JSON téléchargeable). */
    app.get("/api/customers/:id/export", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const data = await exportCustomer(ctx, id, req.user!.id);
      return reply
        .header("Content-Disposition", `attachment; filename="export-client-${id}.json"`)
        .type("application/json")
        .send(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    });

    /** Droit à l'effacement (irréversible). */
    app.delete("/api/customers/:id", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(req.body ?? {});
      const ok = await eraseCustomer(ctx, id, { type: "USER", id: req.user!.id }, reason);
      return ok ? { ok: true } : reply.code(404).send({ error: "Client introuvable" });
    });
  };
