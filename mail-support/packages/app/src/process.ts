import { AiRefusalError, type ThreadMessage } from "@ms/ai";
import { checkReply, decide, formatDateFr, replySubject } from "@ms/core";
import { audit, type Priority } from "@ms/db";
import { gmailLabelName, logger, type Analysis } from "@ms/shared";
import type { AppContext } from "./context";
import { buildFacts } from "./enrich";
import { LABEL_REVIEW } from "./labels";

export interface ProcessResult {
  decision: "AUTO" | "REVIEW" | "NO_REPLY" | "SKIPPED";
  draftId?: string;
  reasons: string[];
}

/**
 * Traitement complet d'un message entrant :
 * classification IA → faits vérifiés → rédaction IA → garde-fou → décision → (envoi auto | validation).
 */
export async function processMessage(
  ctx: AppContext,
  messageId: string,
  opts: { operatorNote?: string; force?: boolean; attempt?: number } = {},
): Promise<ProcessResult> {
  const message = await ctx.db.message.findUnique({
    where: { id: messageId },
    include: { ticket: { include: { customer: true, gmailAccount: true } }, attachments: true },
  });
  if (!message || message.direction !== "INBOUND") return { decision: "SKIPPED", reasons: ["message introuvable"] };
  const { ticket } = message;
  const customer = ticket.customer;

  // Un message plus récent du client existe : c'est lui qui sera traité (avec tout le fil).
  const newer = await ctx.db.message.findFirst({
    where: { ticketId: ticket.id, direction: "INBOUND", receivedAt: { gt: message.receivedAt } },
    select: { id: true },
  });
  if (newer && !opts.force) return { decision: "SKIPPED", reasons: ["message plus récent dans le fil"] };

  // Idempotence : une réponse existe déjà pour ce message (job rejoué).
  if (!opts.force) {
    const done = await ctx.db.draftReply.findFirst({ where: { replyToMessageId: message.id, status: { not: "SUPERSEDED" } }, select: { id: true, decision: true } });
    if (done) return { decision: "SKIPPED", draftId: done.id, reasons: ["réponse déjà préparée"] };
  }

  await ctx.db.ticket.update({ where: { id: ticket.id }, data: { status: "PROCESSING" } });
  const settings = await ctx.settings();

  const previous = await ctx.db.message.findMany({
    where: { ticketId: ticket.id, receivedAt: { lt: message.receivedAt } },
    orderBy: { receivedAt: "asc" },
    take: 10,
  });
  const thread: ThreadMessage[] = previous.slice(-4).map((m) => ({
    direction: m.direction,
    from: m.direction === "INBOUND" ? "client" : "boutique",
    date: formatDateFr(m.receivedAt),
    text: m.bodyText,
  }));

  // ---------- 1. Classification (réutilisée si déjà faite, sauf régénération) ----------
  let analysis: Analysis;
  const existing = opts.force ? null : await ctx.db.aiAnalysis.findFirst({ where: { messageId }, orderBy: { createdAt: "desc" } });
  if (existing) {
    analysis = {
      category: existing.category,
      secondaryCategories: [],
      confidence: existing.confidence,
      language: existing.language,
      sentiment: existing.sentiment as Analysis["sentiment"],
      summary: existing.summary,
      intents: existing.intents as Analysis["intents"],
      extracted: existing.extracted as Analysis["extracted"],
      missingInfo: (existing.extracted as { missingInfo?: string[] }).missingInfo ?? [],
      injectionSuspected: existing.injectionSuspected,
      injectionEvidence: null,
    };
  } else {
    try {
      const res = await ctx.ai.classify({
        from: message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail,
        subject: message.subject,
        receivedAt: formatDateFr(message.receivedAt),
        body: message.bodyText,
        attachments: message.attachments.map((a) => `${a.filename} (${a.mimeType})`),
        thread,
      });
      analysis = res.output;
      await ctx.db.aiAnalysis.create({
        data: {
          messageId,
          ticketId: ticket.id,
          model: res.usage.model,
          promptVersion: res.usage.promptVersion,
          category: analysis.category,
          confidence: analysis.confidence,
          language: analysis.language,
          sentiment: analysis.sentiment,
          summary: analysis.summary,
          extracted: { ...analysis.extracted, missingInfo: analysis.missingInfo, secondaryCategories: analysis.secondaryCategories, injectionEvidence: analysis.injectionEvidence } as never,
          intents: analysis.intents as never,
          riskFlags: riskFlags(analysis),
          injectionSuspected: analysis.injectionSuspected,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          latencyMs: res.usage.latencyMs,
        },
      });
      await audit(ctx.db, {
        actorType: "AI",
        action: "message.classified",
        entityType: "Ticket",
        entityId: ticket.id,
        details: { category: analysis.category, confidence: analysis.confidence, injectionSuspected: analysis.injectionSuspected },
      });
    } catch (err) {
      if (err instanceof AiRefusalError) return escalate(ctx, ticket.id, [`Analyse IA impossible : ${err.message}`]);
      throw err;
    }
  }

  await ctx.db.ticket.update({
    where: { id: ticket.id },
    data: { category: analysis.category, priority: priorityOf(analysis), subject: ticket.subject || message.subject },
  });

  // ---------- 2. Mails automatiques et spam ----------
  if (message.isAutomated) {
    await finalize(ctx, ticket.id, "CLOSED", [], analysis.category);
    await audit(ctx.db, { actorType: "SYSTEM", action: "message.automated_ignored", entityType: "Ticket", entityId: ticket.id });
    return { decision: "NO_REPLY", reasons: ["message automatique"] };
  }

  // ---------- 3. Faits vérifiés ----------
  const enrich =
    analysis.category === "SPAM"
      ? null
      : await buildFacts(ctx, { ticket, customer, message, analysis, settings, accountEmail: ticket.gmailAccount.email, attempt: opts.attempt ?? 1 });
  if (enrich?.orderId) await ctx.db.ticket.update({ where: { id: ticket.id }, data: { orderId: enrich.orderId } });

  // ---------- 4. Rédaction ----------
  let draft = null;
  let draftError: string | null = null;
  if (enrich) {
    try {
      draft = (
        await ctx.ai.draft({
          analysis,
          facts: enrich.facts,
          subject: message.subject,
          body: message.bodyText,
          thread,
          operatorNote: opts.operatorNote,
        })
      ).output;
    } catch (err) {
      if (!(err instanceof AiRefusalError)) throw err;
      draftError = err.message;
    }
  }

  // ---------- 5. Garde-fou et décision ----------
  const guardIssues =
    draft && enrich
      ? checkReply({ body: draft.body, allowedLiterals: enrich.allowedLiterals, allowedDomains: enrich.allowedDomains, allowedEmails: [ticket.gmailAccount.email, customer.email] })
      : [];
  const since = new Date(ctx.now().getTime() - 86_400_000);
  const autoRepliesLast24h = await ctx.db.draftReply.count({ where: { ticketId: ticket.id, decision: "AUTO", status: "SENT", sentAt: { gte: since } } });

  const d = decide({
    settings,
    analysis,
    draft,
    flags: enrich?.facts.flags ?? [],
    guardIssues,
    amountInvolved: enrich?.facts.amountInvolved ?? null,
    isAutomatedSender: message.isAutomated,
    autoRepliesLast24h,
    customerKnownInShopify: enrich?.facts.customer.knownInShopify ?? false,
  });
  if (draftError) d.reasons.unshift(`Rédaction IA impossible : ${draftError}`);

  if (d.decision === "NO_REPLY") {
    await finalize(ctx, ticket.id, analysis.category === "SPAM" ? "SPAM" : "CLOSED", [], analysis.category, analysis.category === "SPAM");
    await audit(ctx.db, { actorType: "SYSTEM", action: "ticket.no_reply", entityType: "Ticket", entityId: ticket.id, details: { category: analysis.category } });
    return { decision: "NO_REPLY", reasons: d.reasons };
  }

  if (!draft) {
    return escalate(ctx, ticket.id, d.reasons.length ? d.reasons : ["Aucune réponse générée"], analysis.category);
  }

  const created = await ctx.db.draftReply.create({
    data: {
      ticketId: ticket.id,
      replyToMessageId: message.id,
      subject: replySubject(message.subject),
      body: draft.body,
      decision: d.decision,
      confidence: d.confidence,
      reviewReasons: d.reasons,
      facts: { ...enrich!.facts, guardIssues, returnRequestId: enrich!.returnRequestId } as never,
      documentIds: enrich!.documentIds,
      status: d.decision === "AUTO" ? "APPROVED" : "DRAFT",
      authorType: "AI",
    },
  });
  await audit(ctx.db, {
    actorType: "AI",
    action: d.decision === "AUTO" ? "draft.auto_approved" : "draft.pending_review",
    entityType: "DraftReply",
    entityId: created.id,
    details: { ticketId: ticket.id, confidence: d.confidence, reasons: d.reasons },
  });

  if (d.decision === "AUTO") {
    await ctx.db.ticket.update({ where: { id: ticket.id }, data: { reviewReasons: [] } });
    await labelThread(ctx, ticket.id, analysis.category, false);
    await ctx.queues.enqueueSend(created.id);
  } else {
    await ctx.db.ticket.update({ where: { id: ticket.id }, data: { status: "PENDING_REVIEW", reviewReasons: d.reasons } });
    await labelThread(ctx, ticket.id, analysis.category, true);
  }
  return { decision: d.decision, draftId: created.id, reasons: d.reasons };
}

function riskFlags(a: Analysis): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(a.intents)) if (v) out.push(k);
  if (a.sentiment === "angry" || a.sentiment === "negative") out.push(`sentiment:${a.sentiment}`);
  if (a.injectionSuspected) out.push("injection");
  return out;
}

function priorityOf(a: Analysis): Priority {
  if (a.intents.legalThreat || a.intents.disputeOrChargeback) return "URGENT";
  if (a.sentiment === "angry" || a.intents.urgent || a.intents.refundRequested) return "HIGH";
  if (a.category === "SPAM" || a.category === "INFO") return "LOW";
  return "NORMAL";
}

async function escalate(ctx: AppContext, ticketId: string, reasons: string[], category?: Analysis["category"]): Promise<ProcessResult> {
  await ctx.db.ticket.update({ where: { id: ticketId }, data: { status: "ESCALATED", reviewReasons: reasons } });
  await audit(ctx.db, { actorType: "SYSTEM", action: "ticket.escalated", entityType: "Ticket", entityId: ticketId, details: { reasons } });
  if (category) await labelThread(ctx, ticketId, category, true);
  return { decision: "REVIEW", reasons };
}

async function finalize(ctx: AppContext, ticketId: string, status: "CLOSED" | "SPAM", reasons: string[], category: Analysis["category"], archive = false) {
  await ctx.db.ticket.update({ where: { id: ticketId }, data: { status, reviewReasons: reasons, closedAt: ctx.now() } });
  await labelThread(ctx, ticketId, category, false, archive);
}

/** Applique les libellés Gmail (catégorie, "À valider") ; archive le spam. Erreurs non bloquantes. */
export async function labelThread(ctx: AppContext, ticketId: string, category: Analysis["category"], review: boolean, archive = false) {
  try {
    const ticket = await ctx.db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    const { service, labelIds } = await ctx.gmail(ticket.gmailAccountId);
    const add = [labelIds[gmailLabelName(category)]].filter((x): x is string => !!x);
    const reviewId = labelIds[LABEL_REVIEW];
    const remove: string[] = archive ? ["INBOX"] : [];
    if (reviewId) (review ? add : remove).push(reviewId);
    await service.modifyThread(ticket.gmailThreadId, add, remove);
  } catch (err) {
    logger.warn({ err: (err as Error).message, ticketId }, "libellés Gmail non appliqués");
  }
}
