import { sha256Hex } from "@ms/crypto";
import { audit, Prisma } from "@ms/db";
import { logger } from "@ms/shared";
import type { AppContext } from "./context";

/** Export RGPD (droit d'accès / portabilité) : toutes les données d'un client au format JSON. */
export async function exportCustomer(ctx: AppContext, customerId: string, actorId: string) {
  const customer = await ctx.db.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: {
      tickets: {
        include: {
          messages: { include: { attachments: { select: { filename: true, mimeType: true, size: true } } } },
          drafts: { select: { subject: true, body: true, status: true, sentAt: true, createdAt: true } },
          warrantyClaims: true,
          returnRequests: true,
          quotes: true,
        },
      },
      orders: { include: { shipments: true } },
    },
  });
  await audit(ctx.db, { actorType: "USER", actorId, action: "customer.exported", entityType: "Customer", entityId: customerId });
  return { exportedAt: ctx.now().toISOString(), customer };
}

/**
 * Droit à l'effacement : supprime le client, ses tickets, messages, analyses, brouillons, dossiers,
 * documents (fichiers inclus) et commandes en cache. Le journal d'audit conserve uniquement
 * une empreinte de l'email (preuve de l'effacement sans donnée personnelle).
 */
export async function eraseCustomer(ctx: AppContext, customerId: string, actor: { type: "USER" | "SYSTEM"; id?: string }, reason: string) {
  const customer = await ctx.db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return false;
  const docs = await ctx.db.document.findMany({ where: { ticket: { customerId } }, select: { storagePath: true } });
  const ticketIds = (await ctx.db.ticket.findMany({ where: { customerId }, select: { id: true } })).map((t) => t.id);

  await ctx.db.$transaction([
    ctx.db.order.deleteMany({ where: { OR: [{ customerId }, { email: customer.email }] } }),
    ctx.db.customer.delete({ where: { id: customerId } }), // cascade : tickets, messages, analyses, brouillons, dossiers, documents
    // Les entrées d'audit liées gardent leur action mais perdent leurs détails.
    ctx.db.auditLog.updateMany({ where: { entityId: { in: [customerId, ...ticketIds] } }, data: { details: Prisma.DbNull } }),
  ]);
  for (const d of docs) await ctx.storage.remove(d.storagePath).catch((err) => logger.warn({ err }, "fichier non supprimé"));
  await audit(ctx.db, {
    actorType: actor.type,
    actorId: actor.id,
    action: "customer.erased",
    entityType: "Customer",
    entityId: customerId,
    details: { emailSha256: sha256Hex(customer.email), tickets: ticketIds.length, reason },
  });
  return true;
}

/**
 * Durée de conservation : supprime les clients sans contact depuis `retentionMonths`
 * et le journal d'audit au-delà de `auditRetentionMonths`.
 */
export async function applyRetention(ctx: AppContext) {
  const s = await ctx.settings();
  let erased = 0;
  if (s.retentionMonths > 0) {
    const cutoff = new Date(ctx.now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - s.retentionMonths);
    const stale = await ctx.db.customer.findMany({
      where: { OR: [{ lastContactAt: { lt: cutoff } }, { lastContactAt: null, createdAt: { lt: cutoff } }] },
      select: { id: true },
      take: 500,
    });
    for (const c of stale) if (await eraseCustomer(ctx, c.id, { type: "SYSTEM" }, "durée de conservation")) erased++;
  }
  const auditCutoff = new Date(ctx.now());
  auditCutoff.setUTCMonth(auditCutoff.getUTCMonth() - s.auditRetentionMonths);
  const audits = await ctx.db.auditLog.deleteMany({ where: { at: { lt: auditCutoff } } });
  const events = await ctx.db.processedEvent.deleteMany({ where: { receivedAt: { lt: new Date(ctx.now().getTime() - 30 * 86_400_000) } } });
  logger.info({ erased, audits: audits.count, events: events.count }, "conservation appliquée");
  return { erased, auditsDeleted: audits.count };
}
