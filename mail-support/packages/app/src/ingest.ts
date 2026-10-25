import { isAutomatedEmail, normalizeEmail } from "@ms/core";
import { audit } from "@ms/db";
import type { ParsedMessage } from "@ms/gmail";
import { logger } from "@ms/shared";
import type { AppContext } from "./context";

export type IngestOutcome = "created" | "duplicate" | "skipped" | "outbound" | "deleted";

/** Libellés Gmail qu'on ignore (brouillons, corbeille, spam détecté par Gmail). */
const IGNORED_LABELS = ["DRAFT", "TRASH", "SPAM"];

/**
 * Enregistre un message Gmail : client (par email), ticket (par fil), message, pièces jointes.
 * Idempotent : un message déjà connu n'est jamais retraité.
 */
export async function ingestMessage(ctx: AppContext, accountId: string, gmailMessageId: string): Promise<{ outcome: IngestOutcome; messageId?: string }> {
  if (await ctx.db.message.findUnique({ where: { gmailMessageId }, select: { id: true } })) return { outcome: "duplicate" };

  const { service, email: accountEmail } = await ctx.gmail(accountId);
  const msg = await service.getMessage(gmailMessageId);
  if (!msg) return { outcome: "deleted" };
  if (msg.labelIds.some((l) => IGNORED_LABELS.includes(l))) return { outcome: "skipped" };

  if (msg.fromEmail === normalizeEmail(accountEmail)) {
    return recordOutbound(ctx, accountId, msg);
  }

  const automated = isAutomatedEmail(msg.headers, msg.fromEmail);
  const { messageId, ticketId, reopened } = await ctx.db.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { email: msg.fromEmail },
      create: { email: msg.fromEmail, name: msg.fromName, lastContactAt: msg.receivedAt },
      update: { lastContactAt: msg.receivedAt, ...(msg.fromName ? { name: msg.fromName } : {}) },
    });

    let ticket = await tx.ticket.findUnique({ where: { gmailThreadId: msg.threadId } });
    let reopened = false;
    if (!ticket) {
      ticket = await tx.ticket.create({
        data: {
          gmailThreadId: msg.threadId,
          gmailAccountId: accountId,
          customerId: customer.id,
          subject: msg.subject || "(sans objet)",
          status: "NEW",
          lastMessageAt: msg.receivedAt,
        },
      });
    } else {
      reopened = ["CLOSED", "REPLIED", "AUTO_REPLIED", "WAITING_CUSTOMER"].includes(ticket.status);
      ticket = await tx.ticket.update({
        where: { id: ticket.id },
        data: { lastMessageAt: msg.receivedAt, status: "NEW", closedAt: null },
      });
      // Un nouveau message du client rend obsolètes les brouillons en attente.
      await tx.draftReply.updateMany({ where: { ticketId: ticket.id, status: { in: ["DRAFT", "APPROVED"] } }, data: { status: "SUPERSEDED" } });
    }

    const message = await tx.message.create({
      data: {
        ticketId: ticket.id,
        gmailMessageId: msg.gmailMessageId,
        rfcMessageId: msg.rfcMessageId,
        references: msg.references,
        direction: "INBOUND",
        fromEmail: msg.fromEmail,
        fromName: msg.fromName,
        toEmails: msg.toEmails,
        ccEmails: msg.ccEmails,
        subject: msg.subject,
        bodyText: msg.bodyText,
        bodyFull: msg.bodyFull,
        snippet: msg.snippet,
        isAutomated: automated.automated,
        receivedAt: msg.receivedAt,
        attachments: {
          create: msg.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, gmailAttachmentId: a.attachmentId })),
        },
      },
    });
    return { messageId: message.id, ticketId: ticket.id, reopened };
  });

  await audit(ctx.db, {
    actorType: "CUSTOMER",
    action: reopened ? "ticket.reopened" : "message.received",
    entityType: "Ticket",
    entityId: ticketId,
    details: { messageId, automated: automated.automated, attachments: msg.attachments.length },
  });
  await ctx.queues.enqueueProcess(messageId);
  return { outcome: "created", messageId };
}

/**
 * Message envoyé depuis la boîte : soit par ce logiciel (déjà enregistré à l'envoi),
 * soit par un humain directement dans Gmail → on l'archive dans le ticket et on clôt les brouillons.
 */
async function recordOutbound(ctx: AppContext, accountId: string, msg: ParsedMessage): Promise<{ outcome: IngestOutcome; messageId?: string }> {
  const ticket = await ctx.db.ticket.findUnique({ where: { gmailThreadId: msg.threadId } });
  if (!ticket) return { outcome: "skipped" };
  const fromApp = Boolean(msg.headers["x-ms-draft-id"]);
  const message = await ctx.db.message.create({
    data: {
      ticketId: ticket.id,
      gmailMessageId: msg.gmailMessageId,
      rfcMessageId: msg.rfcMessageId,
      references: msg.references,
      direction: "OUTBOUND",
      fromEmail: msg.fromEmail,
      toEmails: msg.toEmails,
      ccEmails: msg.ccEmails,
      subject: msg.subject,
      bodyText: msg.bodyText,
      bodyFull: msg.bodyFull,
      snippet: msg.snippet,
      receivedAt: msg.receivedAt,
    },
  });
  if (!fromApp) {
    await ctx.db.draftReply.updateMany({ where: { ticketId: ticket.id, status: { in: ["DRAFT", "APPROVED"] } }, data: { status: "SUPERSEDED" } });
    await ctx.db.ticket.update({
      where: { id: ticket.id },
      data: { status: "REPLIED", firstResponseAt: ticket.firstResponseAt ?? msg.receivedAt, reviewReasons: [] },
    });
    await audit(ctx.db, { actorType: "USER", action: "reply.sent_from_gmail", entityType: "Ticket", entityId: ticket.id, details: { gmailMessageId: msg.gmailMessageId } });
    logger.info({ ticket: ticket.number }, "réponse envoyée manuellement depuis Gmail");
  }
  return { outcome: "outbound", messageId: message.id };
}
