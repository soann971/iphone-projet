import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "@ms/app";
import { replySubject } from "@ms/core";
import { audit, type Prisma } from "@ms/db";
import { CATEGORIES } from "@ms/shared";
import { requireRole } from "../auth";

const STATUS_GROUPS: Record<string, string[]> = {
  review: ["PENDING_REVIEW", "ESCALATED", "ERROR"],
  open: ["NEW", "PROCESSING", "PENDING_REVIEW", "ESCALATED", "ERROR", "WAITING_CUSTOMER"],
  done: ["AUTO_REPLIED", "REPLIED", "CLOSED"],
  spam: ["SPAM"],
};

const ListQuery = z.object({
  status: z.string().optional(),
  category: z.enum(CATEGORIES).optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const Id = z.object({ id: z.string().min(1) });

export const ticketRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    const viewer = { preHandler: requireRole("VIEWER") };
    const agent = { preHandler: requireRole("AGENT") };

    app.get("/api/tickets", viewer, async (req) => {
      const q = ListQuery.parse(req.query);
      const where: Prisma.TicketWhereInput = {};
      if (q.status && q.status !== "all") where.status = { in: (STATUS_GROUPS[q.status] ?? [q.status]) as never };
      if (q.category) where.category = q.category;
      if (q.q) {
        const n = Number(q.q.replace("#", ""));
        where.OR = [
          { subject: { contains: q.q, mode: "insensitive" } },
          { customer: { email: { contains: q.q, mode: "insensitive" } } },
          { customer: { name: { contains: q.q, mode: "insensitive" } } },
          ...(Number.isInteger(n) && n > 0 && n < 2 ** 31 ? [{ number: n }] : []),
        ];
      }
      const [total, items] = await Promise.all([
        ctx.db.ticket.count({ where }),
        ctx.db.ticket.findMany({
          where,
          orderBy: [{ lastMessageAt: "desc" }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: {
            customer: { select: { email: true, name: true } },
            order: { select: { name: true } },
            drafts: { where: { status: { in: ["DRAFT", "APPROVED", "SENDING", "FAILED"] } }, select: { id: true, status: true, confidence: true }, take: 1, orderBy: { createdAt: "desc" } },
            _count: { select: { messages: true } },
          },
        }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items };
    });

    app.get("/api/tickets/:id", viewer, async (req, reply) => {
      const { id } = Id.parse(req.params);
      const ticket = await ctx.db.ticket.findUnique({
        where: { id },
        include: {
          customer: true,
          order: { include: { shipments: true } },
          assignee: { select: { id: true, name: true } },
          messages: { orderBy: { receivedAt: "asc" }, include: { attachments: true } },
          analyses: { orderBy: { createdAt: "desc" } },
          drafts: { orderBy: { createdAt: "desc" }, include: { approvedBy: { select: { name: true } } } },
          documents: { orderBy: { createdAt: "desc" }, select: { id: true, kind: true, filename: true, size: true, createdAt: true } },
          warrantyClaims: true,
          returnRequests: true,
          quotes: true,
        },
      });
      if (!ticket) return reply.code(404).send({ error: "Ticket introuvable" });
      const history = await ctx.db.auditLog.findMany({
        where: { OR: [{ entityId: id }, { entityId: { in: ticket.drafts.map((d) => d.id) } }] },
        orderBy: { at: "desc" },
        take: 100,
      });
      const otherTickets = await ctx.db.ticket.findMany({
        where: { customerId: ticket.customerId, id: { not: id } },
        select: { id: true, number: true, subject: true, status: true, lastMessageAt: true },
        orderBy: { lastMessageAt: "desc" },
        take: 10,
      });
      return { ...ticket, history, otherTickets };
    });

    const Patch = z.object({
      status: z.enum(["NEW", "PENDING_REVIEW", "WAITING_CUSTOMER", "ESCALATED", "CLOSED", "SPAM"]).optional(),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
      category: z.enum(CATEGORIES).optional(),
      assigneeId: z.string().nullable().optional(),
    });
    app.patch("/api/tickets/:id", agent, async (req) => {
      const { id } = Id.parse(req.params);
      const data = Patch.parse(req.body);
      const before = await ctx.db.ticket.findUniqueOrThrow({ where: { id }, select: { status: true, priority: true, category: true, assigneeId: true } });
      const ticket = await ctx.db.ticket.update({
        where: { id },
        data: { ...data, ...(data.status === "CLOSED" ? { closedAt: new Date() } : {}) },
      });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "ticket.updated", entityType: "Ticket", entityId: id, details: { before, after: data } });
      return ticket;
    });

    /** Relance l'IA sur le dernier message du client, avec une consigne facultative. */
    app.post("/api/tickets/:id/regenerate", agent, async (req, reply) => {
      const { id } = Id.parse(req.params);
      const { note } = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
      const last = await ctx.db.message.findFirst({ where: { ticketId: id, direction: "INBOUND" }, orderBy: { receivedAt: "desc" } });
      if (!last) return reply.code(400).send({ error: "Aucun message client" });
      await ctx.db.draftReply.updateMany({ where: { ticketId: id, status: "DRAFT" }, data: { status: "SUPERSEDED" } });
      await ctx.db.ticket.update({ where: { id }, data: { status: "PROCESSING" } });
      await ctx.queues.enqueueProcess(last.id, { operatorNote: note || undefined, force: true });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "ticket.regenerate", entityType: "Ticket", entityId: id, details: { withNote: !!note } });
      return { ok: true };
    });

    /** Réponse rédigée entièrement par un opérateur. */
    app.post("/api/tickets/:id/drafts", agent, async (req) => {
      const { id } = Id.parse(req.params);
      const { body } = z.object({ body: z.string().min(1).max(20_000) }).parse(req.body);
      const last = await ctx.db.message.findFirst({ where: { ticketId: id, direction: "INBOUND" }, orderBy: { receivedAt: "desc" } });
      const ticket = await ctx.db.ticket.findUniqueOrThrow({ where: { id } });
      await ctx.db.draftReply.updateMany({ where: { ticketId: id, status: "DRAFT" }, data: { status: "SUPERSEDED" } });
      const draft = await ctx.db.draftReply.create({
        data: {
          ticketId: id,
          replyToMessageId: last?.id ?? null,
          subject: replySubject(last?.subject ?? ticket.subject),
          body,
          decision: "REVIEW",
          confidence: 1,
          status: "DRAFT",
          authorType: "USER",
          authorId: req.user!.id,
        },
      });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "draft.created_manual", entityType: "DraftReply", entityId: draft.id, details: { ticketId: id } });
      return draft;
    });

    app.patch("/api/drafts/:id", agent, async (req, reply) => {
      const { id } = Id.parse(req.params);
      const data = z.object({ body: z.string().min(1).max(20_000), subject: z.string().min(1).max(500).optional() }).parse(req.body);
      const res = await ctx.db.draftReply.updateMany({ where: { id, status: "DRAFT" }, data });
      if (!res.count) return reply.code(409).send({ error: "Ce brouillon n'est plus modifiable" });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "draft.edited", entityType: "DraftReply", entityId: id });
      return ctx.db.draftReply.findUnique({ where: { id } });
    });

    /** Validation humaine : la réponse part immédiatement (file d'envoi). */
    app.post("/api/drafts/:id/approve", agent, async (req, reply) => {
      const { id } = Id.parse(req.params);
      const res = await ctx.db.draftReply.updateMany({
        where: { id, status: { in: ["DRAFT", "FAILED"] } },
        data: { status: "APPROVED", approvedById: req.user!.id, approvedAt: new Date(), error: null },
      });
      if (!res.count) return reply.code(409).send({ error: "Brouillon déjà traité" });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "draft.approved", entityType: "DraftReply", entityId: id });
      await ctx.queues.send.add("send", { draftId: id }, { jobId: `send-${id}-${Date.now()}` });
      return { ok: true };
    });

    app.post("/api/drafts/:id/reject", agent, async (req, reply) => {
      const { id } = Id.parse(req.params);
      const { reason } = z.object({ reason: z.string().max(1000).optional() }).parse(req.body ?? {});
      const res = await ctx.db.draftReply.updateMany({ where: { id, status: "DRAFT" }, data: { status: "REJECTED", error: reason ?? null } });
      if (!res.count) return reply.code(409).send({ error: "Brouillon déjà traité" });
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "draft.rejected", entityType: "DraftReply", entityId: id, details: { reason } });
      return { ok: true };
    });

    app.get("/api/documents/:id", viewer, async (req, reply) => {
      const { id } = Id.parse(req.params);
      const doc = await ctx.db.document.findUnique({ where: { id } });
      if (!doc) return reply.code(404).send({ error: "Document introuvable" });
      const content = await ctx.storage.read(doc.storagePath);
      return reply
        .header("Content-Type", doc.mimeType)
        .header("Content-Disposition", `inline; filename="${doc.filename.replace(/"/g, "")}"`)
        .header("X-Content-Type-Options", "nosniff")
        .send(content);
    });

    /** Pièce jointe d'un client, téléchargée à la demande depuis Gmail (jamais affichée en ligne). */
    app.get("/api/attachments/:id", viewer, async (req, reply) => {
      const { id } = Id.parse(req.params);
      const att = await ctx.db.attachment.findUnique({ where: { id }, include: { message: { include: { ticket: true } } } });
      if (!att?.gmailAttachmentId) return reply.code(404).send({ error: "Pièce jointe introuvable" });
      const { service } = await ctx.gmail(att.message.ticket.gmailAccountId);
      const content = await service.getAttachment(att.message.gmailMessageId, att.gmailAttachmentId);
      await audit(ctx.db, { actorType: "USER", actorId: req.user!.id, action: "attachment.downloaded", entityType: "Attachment", entityId: id });
      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Disposition", `attachment; filename="${encodeURIComponent(att.filename)}"`)
        .header("X-Content-Type-Options", "nosniff")
        .send(content);
    });
  };
