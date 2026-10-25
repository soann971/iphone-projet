import { audit } from "@ms/db";
import { logger, PermanentError } from "@ms/shared";
import type { AppContext } from "./context";
import { LABEL_AUTO, LABEL_DONE, LABEL_REVIEW } from "./labels";

/** Corps final : réponse + signature. */
export function composeBody(body: string, signature: string): string {
  const sig = signature.trim();
  return sig ? `${body.trim()}\n\n${sig}\n` : `${body.trim()}\n`;
}

/**
 * Envoie une réponse approuvée (automatiquement ou par un humain) dans le fil Gmail.
 * Idempotent : verrouillage APPROVED → SENDING en base, et en-tête X-MS-Draft-Id vérifié dans le fil
 * avant tout renvoi (protège contre un double envoi si le processus plante après l'envoi).
 */
export async function sendDraft(ctx: AppContext, draftId: string): Promise<"sent" | "already_sent" | "not_approved"> {
  const lock = await ctx.db.draftReply.updateMany({ where: { id: draftId, status: { in: ["APPROVED", "SENDING"] } }, data: { status: "SENDING" } });
  if (lock.count === 0) {
    const d = await ctx.db.draftReply.findUnique({ where: { id: draftId }, select: { status: true } });
    return d?.status === "SENT" ? "already_sent" : "not_approved";
  }

  const draft = await ctx.db.draftReply.findUniqueOrThrow({
    where: { id: draftId },
    include: { ticket: { include: { customer: true, gmailAccount: true, messages: { orderBy: { receivedAt: "desc" }, take: 1, where: { direction: "INBOUND" } } } } },
  });
  const { ticket } = draft;
  const replyTo = draft.replyToMessageId
    ? await ctx.db.message.findUnique({ where: { id: draft.replyToMessageId } })
    : (ticket.messages[0] ?? null);
  const settings = await ctx.settings();
  const { service, email: from, labelIds } = await ctx.gmail(ticket.gmailAccountId);

  try {
    let gmailId = await service.threadHasHeader(ticket.gmailThreadId, "X-MS-Draft-Id", draft.id);
    if (!gmailId) {
      const docs = draft.documentIds.length ? await ctx.db.document.findMany({ where: { id: { in: draft.documentIds } } }) : [];
      const attachments = await Promise.all(docs.map(async (d) => ({ filename: d.filename, mimeType: d.mimeType, content: await ctx.storage.read(d.storagePath) })));
      const sent = await service.send(ticket.gmailThreadId, {
        from: `${settings.shopName} <${from}>`,
        to: ticket.customer.email,
        subject: draft.subject,
        text: composeBody(draft.body, settings.signature),
        inReplyTo: replyTo?.rfcMessageId,
        references: replyTo?.references,
        attachments,
        extraHeaders: { "X-MS-Draft-Id": draft.id },
        autoReplied: draft.decision === "AUTO" && !draft.approvedById,
      });
      gmailId = sent.id;
    }

    const now = ctx.now();
    const facts = draft.facts as { missing?: string[]; returnRequestId?: string | null };
    const waiting = (facts.missing?.length ?? 0) > 0;
    await ctx.db.$transaction([
      ctx.db.draftReply.update({ where: { id: draft.id }, data: { status: "SENT", sentAt: now, sentGmailMessageId: gmailId, error: null } }),
      ctx.db.message.upsert({
        where: { gmailMessageId: gmailId },
        create: {
          ticketId: ticket.id,
          gmailMessageId: gmailId,
          direction: "OUTBOUND",
          fromEmail: from,
          toEmails: [ticket.customer.email],
          subject: draft.subject,
          bodyText: draft.body,
          bodyFull: composeBody(draft.body, settings.signature),
          receivedAt: now,
        },
        update: {},
      }),
      ctx.db.ticket.update({
        where: { id: ticket.id },
        data: {
          status: waiting ? "WAITING_CUSTOMER" : draft.approvedById ? "REPLIED" : "AUTO_REPLIED",
          firstResponseAt: ticket.firstResponseAt ?? now,
          reviewReasons: [],
        },
      }),
    ]);
    await audit(ctx.db, {
      actorType: draft.approvedById ? "USER" : "SYSTEM",
      actorId: draft.approvedById,
      action: draft.approvedById ? "reply.sent_after_review" : "reply.sent_auto",
      entityType: "DraftReply",
      entityId: draft.id,
      details: { ticketId: ticket.id, gmailMessageId: gmailId, attachments: draft.documentIds.length },
    });

    const add = [labelIds[draft.approvedById ? LABEL_DONE : LABEL_AUTO]].filter((x): x is string => !!x);
    const remove = [labelIds[LABEL_REVIEW]].filter((x): x is string => !!x);
    await service.modifyThread(ticket.gmailThreadId, add, remove).catch((err) => logger.warn({ err: (err as Error).message }, "libellés non mis à jour"));

    if (facts.returnRequestId && settings.shopifyCreateReturns) await createShopifyReturn(ctx, facts.returnRequestId);
    return "sent";
  } catch (err) {
    await ctx.db.draftReply.update({ where: { id: draft.id }, data: { status: err instanceof PermanentError ? "FAILED" : "APPROVED", error: (err as Error).message } });
    throw err;
  }
}

/** Crée la demande de retour dans Shopify (non bloquant : l'opérateur est prévenu via l'audit). */
async function createShopifyReturn(ctx: AppContext, returnRequestId: string) {
  if (!ctx.shopify) return;
  const rr = await ctx.db.returnRequest.findUnique({ where: { id: returnRequestId } });
  if (!rr?.orderId || rr.shopifyReturnId) return;
  const order = await ctx.db.order.findUnique({ where: { id: rr.orderId } });
  const items = rr.items as { quantity: number; fulfillmentLineItems: { id: string; quantity: number }[] }[];
  const lines = items.flatMap((i) => i.fulfillmentLineItems.map((f) => ({ fulfillmentLineItemId: f.id, quantity: Math.min(f.quantity, i.quantity) })));
  if (!order || !lines.length) return;
  try {
    const ret = await ctx.shopify.createReturnRequest({ orderId: order.shopifyId, lines, note: `${rr.rmaNumber} ${rr.reason ?? ""}`.trim() });
    await ctx.db.returnRequest.update({ where: { id: rr.id }, data: { shopifyReturnId: ret.id, status: "APPROVED" } });
    await audit(ctx.db, { actorType: "SYSTEM", action: "shopify.return_created", entityType: "ReturnRequest", entityId: rr.id, details: { shopifyReturnId: ret.id } });
  } catch (err) {
    await audit(ctx.db, { actorType: "SYSTEM", action: "shopify.return_failed", entityType: "ReturnRequest", entityId: rr.id, details: { error: (err as Error).message } });
  }
}
