/**
 * Test de bout en bout du pipeline sur une vraie base PostgreSQL.
 * Lancement : TEST_DATABASE_URL=postgresql://… pnpm test packages/app
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { disconnectDb } from "@ms/db";
import type { ShopOrder } from "@ms/integrations";
import type { Analysis, Settings } from "@ms/shared";
import { ingestMessage } from "./ingest";
import { processMessage } from "./process";
import { sendDraft } from "./send";
import { eraseCustomer } from "./privacy";
import { createTestContext, fakeAi, fakeShopify, inbound, resetDb, SUPPORT_EMAIL } from "./testing";

const enabled = !!process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-25T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const ALICE = "alice@client.test";
const BOB = "bob@client.test";

function order(over: Partial<ShopOrder> & { name: string; email: string }): ShopOrder {
  return {
    shopifyId: `gid://shopify/Order/${over.name.slice(1)}`,
    customerId: null,
    createdAt: daysAgo(10),
    cancelledAt: null,
    currency: "EUR",
    totalPrice: 49.9,
    financialStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    lineItems: [
      { id: "li1", title: "Coque iPhone 13 bleue", sku: "C13B", quantity: 1, variantId: "v1", productId: "p1", warrantyMonths: null, fulfillmentLineItems: [{ id: "fli1", quantity: 1 }] },
    ],
    fulfillments: [
      {
        id: `gid://shopify/Fulfillment/${over.name.slice(1)}`,
        createdAt: daysAgo(9),
        deliveredAt: null,
        inTransitAt: daysAgo(8),
        estimatedDeliveryAt: null,
        displayStatus: "IN_TRANSIT",
        tracking: [{ company: "Colissimo", number: "6A12345678901", url: "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901" }],
      },
    ],
    ...over,
  };
}

const ORDERS: ShopOrder[] = [
  order({ name: "#1060", email: ALICE }),
  order({ name: "#1052", email: BOB }),
  order({
    name: "#1081",
    email: ALICE,
    createdAt: daysAgo(8),
    totalPrice: 349.9,
    lineItems: [{ id: "li2", title: "iPhone 13 128 Go", sku: "IP13", quantity: 1, variantId: "v2", productId: "p2", warrantyMonths: 12, fulfillmentLineItems: [{ id: "fli2", quantity: 1 }] }],
    fulfillments: [
      { id: "gid://shopify/Fulfillment/1081", createdAt: daysAgo(7), deliveredAt: daysAgo(5), inTransitAt: daysAgo(7), estimatedDeliveryAt: null, displayStatus: "DELIVERED", tracking: [] },
    ],
  }),
  order({
    name: "#1012",
    email: ALICE,
    createdAt: daysAgo(500),
    totalPrice: 299,
    lineItems: [{ id: "li3", title: "iPhone 12 64 Go", sku: "IP12", quantity: 1, variantId: "v3", productId: "p3", warrantyMonths: 12, fulfillmentLineItems: [] }],
    fulfillments: [{ id: "gid://shopify/Fulfillment/1012", createdAt: daysAgo(499), deliveredAt: daysAgo(497), inTransitAt: null, estimatedDeliveryAt: null, displayStatus: "DELIVERED", tracking: [] }],
  }),
];

const VARIANTS = [
  { variantId: "v10", title: "128 Go / Grade A", productTitle: "iPhone 13", displayName: "iPhone 13 - 128 Go / Grade A", sku: "IP13-128-A", price: 349.9, availableForSale: true, inventoryQuantity: 20 },
  { variantId: "v11", title: "Transparente", productTitle: "Coque iPhone 13", displayName: "Coque iPhone 13 - Transparente", sku: "C13T", price: 14.9, availableForSale: true, inventoryQuantity: 50 },
];

function analysis(over: Partial<Analysis> & { category: Analysis["category"] }): Analysis {
  return {
    secondaryCategories: [],
    confidence: 0.95,
    language: "fr",
    sentiment: "neutral",
    summary: "résumé",
    intents: { refundRequested: false, disputeOrChargeback: false, legalThreat: false, cancellationRequested: false, complaint: false, urgent: false },
    extracted: { customerName: null, phone: null, orderNumbers: [], trackingNumbers: [], products: [], serialNumbers: [], issueDescription: null, purchaseDateMentioned: null, returnReason: null },
    missingInfo: [],
    injectionSuspected: false,
    injectionEvidence: null,
    ...over,
  };
}

/** Classification simulée selon des mots-clés du sujet. */
function classify(subject: string): Analysis {
  if (subject.includes("colis")) return analysis({ category: "SHIPPING", extracted: { ...analysis({ category: "SHIPPING" }).extracted, orderNumbers: subject.includes("1052") ? ["#1052"] : ["#1060"] } });
  if (subject.includes("Retour")) return analysis({ category: "RETURN", extracted: { ...analysis({ category: "RETURN" }).extracted, orderNumbers: ["#1081"], returnReason: "ne convient pas" } });
  if (subject.includes("Garantie"))
    return analysis({ category: "WARRANTY", extracted: { ...analysis({ category: "WARRANTY" }).extracted, orderNumbers: ["#1012"], issueDescription: "batterie", products: [{ name: "iPhone 12", quantity: 1 }] } });
  if (subject.includes("Devis"))
    return analysis({
      category: "QUOTE",
      extracted: { ...analysis({ category: "QUOTE" }).extracted, products: [{ name: "iPhone 13 128 Go Grade A", quantity: 10 }, { name: "Coque iPhone 13 transparente", quantity: 10 }] },
    });
  if (subject.includes("SEO")) return analysis({ category: "SPAM", confidence: 0.98 });
  return analysis({ category: "INFO" });
}

/** Rédaction simulée : cite uniquement les faits (ou invente si demandé). */
function draft(i: { facts: { order?: { name: string }; shipments?: { trackingNumber: string | null; trackingUrl: string | null }[] }; body: string }) {
  const s = i.facts.shipments?.[0];
  let body = "Bonjour,\nMerci pour votre message.";
  if (i.facts.order) body += ` Votre commande ${i.facts.order.name} est en cours d'acheminement.`;
  if (s?.trackingNumber) body += ` Suivi : ${s.trackingNumber} ${s.trackingUrl}`;
  if (i.body.includes("INVENTE")) body += " Vous serez remboursé de 59,90 €.";
  return { body: `${body}\nBien cordialement,`, confidence: 0.93, needsHuman: false, needsHumanReason: null, missingInfoRequested: [] };
}

async function setup(settings: Partial<Settings> = { autoSendEnabled: true, amountReviewThreshold: 150 }) {
  const ai = fakeAi({ classify, draft: draft as never });
  const shopify = fakeShopify({ orders: ORDERS, variants: VARIANTS });
  const t = await createTestContext({ ai, shopify, settings: { shopUrl: "https://boutique.test", ...settings }, now: NOW });
  return { ...t, ai, shopify };
}

async function receive(t: Awaited<ReturnType<typeof setup>>, msg: Parameters<typeof inbound>[0]) {
  const m = inbound({ receivedAt: NOW, ...msg });
  t.gmail.messages.set(m.gmailMessageId, m);
  const r = await ingestMessage(t.ctx, t.account.id, m.gmailMessageId);
  return { m, r, result: r.messageId ? await processMessage(t.ctx, r.messageId) : null };
}

describe.skipIf(!enabled)("pipeline complet (PostgreSQL)", () => {
  beforeEach(resetDb);
  afterAll(disconnectDb);

  it("suivi de colis simple : réponse automatique envoyée dans le fil avec signature", async () => {
    const t = await setup();
    const { m, result } = await receive(t, { fromEmail: ALICE, subject: "Où est mon colis #1060 ?", bodyText: "Bonjour, où est mon colis ?" });
    expect(result?.decision).toBe("AUTO");
    expect(t.queues.jobs.send).toHaveLength(1);

    const ticket = await t.ctx.db.ticket.findFirstOrThrow({ include: { order: true } });
    expect(ticket.category).toBe("SHIPPING");
    expect(ticket.order?.name).toBe("#1060");

    expect(await sendDraft(t.ctx, t.queues.jobs.send[0]!)).toBe("sent");
    const sent = t.gmail.sent[0]!;
    expect(sent.threadId).toBe(m.threadId);
    expect(sent.msg.inReplyTo).toBe(m.rfcMessageId);
    expect(sent.msg.extraHeaders?.["X-MS-Draft-Id"]).toBe(t.queues.jobs.send[0]);
    expect(sent.msg.autoReplied).toBe(true);
    expect(sent.msg.text).toContain("6A12345678901");
    expect(sent.msg.text).toContain("L'équipe service client");

    const after = await t.ctx.db.ticket.findFirstOrThrow({ include: { messages: true } });
    expect(after.status).toBe("AUTO_REPLIED");
    expect(after.firstResponseAt).not.toBeNull();
    expect(after.messages.map((x) => x.direction).sort()).toEqual(["INBOUND", "OUTBOUND"]);
    expect(await t.ctx.db.auditLog.count({ where: { action: "reply.sent_auto" } })).toBe(1);

    // Rejouer l'envoi ne renvoie pas le mail.
    expect(await sendDraft(t.ctx, t.queues.jobs.send[0]!)).toBe("already_sent");
    expect(t.gmail.sent).toHaveLength(1);
  });

  it("envoi automatique désactivé par défaut → validation humaine", async () => {
    const t = await setup({});
    const { result } = await receive(t, { fromEmail: ALICE, subject: "Où est mon colis #1060 ?", bodyText: "?" });
    expect(result?.decision).toBe("REVIEW");
    expect(result?.reasons.join()).toMatch(/désactivé/);
    expect((await t.ctx.db.ticket.findFirstOrThrow()).status).toBe("PENDING_REVIEW");
    expect(t.gmail.modified.at(-1)?.add).toContain(t.labelIds["Support/À valider"]);
  });

  it("ne divulgue jamais la commande d'un autre client", async () => {
    const t = await setup();
    const { result } = await receive(t, { fromEmail: ALICE, subject: "Où est mon colis #1052 ?", bodyText: "?" });
    expect(result?.decision).toBe("REVIEW");
    expect(result?.reasons.join()).toMatch(/titulaire/);
    const facts = t.ai.drafts[0]!.facts;
    expect(facts.order).toBeUndefined();
    expect(JSON.stringify(facts)).not.toContain("#1052");
  });

  it("donnée inventée par l'IA → bloquée par le garde-fou", async () => {
    const t = await setup();
    const { result } = await receive(t, { fromEmail: ALICE, subject: "Où est mon colis #1060 ?", bodyText: "INVENTE" });
    expect(result?.decision).toBe("REVIEW");
    expect(result?.reasons.join()).toMatch(/59,90/);
  });

  it("retour dans le délai : bon de retour PDF joint, montant > seuil → validation, puis envoi + retour Shopify", async () => {
    const t = await setup();
    const { result } = await receive(t, { fromEmail: ALICE, subject: "Retour iPhone", bodyText: "Je souhaite me rétracter." });
    expect(result?.decision).toBe("REVIEW");
    expect(result?.reasons.join()).toMatch(/seuil/);

    const rr = await t.ctx.db.returnRequest.findFirstOrThrow();
    expect(rr.eligible).toBe(true);
    expect(rr.rmaNumber).toMatch(/^RET-2026-\d{5}$/);
    const draftRow = await t.ctx.db.draftReply.findFirstOrThrow();
    expect(draftRow.documentIds).toHaveLength(1);

    const user = await t.ctx.db.user.create({ data: { email: "op@b.test", name: "Op", passwordHash: "x" } });
    await t.ctx.db.draftReply.update({ where: { id: draftRow.id }, data: { status: "APPROVED", approvedById: user.id, approvedAt: NOW } });
    expect(await sendDraft(t.ctx, draftRow.id)).toBe("sent");
    expect(t.gmail.sent[0]!.msg.attachments?.[0]?.filename).toMatch(/procedure-retour-RET-2026/);
    expect(t.gmail.sent[0]!.msg.autoReplied).toBe(false);
    expect(t.shopify.calls.returns).toHaveLength(1);
    expect((await t.ctx.db.returnRequest.findFirstOrThrow()).shopifyReturnId).toBe("gid://shopify/Return/1");
    expect((await t.ctx.db.ticket.findFirstOrThrow()).status).toBe("REPLIED");
  });

  it("garantie expirée → refus toujours soumis à validation humaine", async () => {
    const t = await setup();
    const { result } = await receive(t, { fromEmail: ALICE, subject: "Garantie batterie", bodyText: "Ma batterie est HS." });
    expect(result?.decision).toBe("REVIEW");
    expect(result?.reasons).toContain("Garantie refusée (expirée ou non applicable)");
    const claim = await t.ctx.db.warrantyClaim.findFirstOrThrow();
    expect(claim).toMatchObject({ eligible: false, warrantyMonths: 12, productTitle: "iPhone 12 64 Go" });
  });

  it("devis : prix du catalogue, PDF, commande provisoire Shopify", async () => {
    const t = await setup();
    const { result } = await receive(t, { fromEmail: "achats@pro.test", subject: "Devis", bodyText: "10 iPhone 13 et 10 coques" });
    const quote = await t.ctx.db.quote.findFirstOrThrow();
    expect(quote.number).toMatch(/^DEV-2026-/);
    expect(Number(quote.totalTtc)).toBeCloseTo(3648, 2);
    expect(quote.invoiceUrl).toContain("invoices");
    expect(t.shopify.calls.draftOrders).toHaveLength(1);
    expect(result?.decision).toBe("REVIEW"); // 3 648 € > seuil
    const facts = t.ai.drafts[0]!.facts;
    expect(facts.quote?.totalTtc).toBe("3 648,00 €");
    expect(facts.quote?.pdfAttached).toBe(true);
  });

  it("spam : pas de réponse, archivé", async () => {
    const t = await setup();
    const { result } = await receive(t, { fromEmail: "growth@seo.test", subject: "Offre SEO", bodyText: "Première page Google" });
    expect(result?.decision).toBe("NO_REPLY");
    expect((await t.ctx.db.ticket.findFirstOrThrow()).status).toBe("SPAM");
    expect(t.gmail.modified.at(-1)?.remove).toContain("INBOX");
    expect(t.ai.drafts).toHaveLength(0);
  });

  it("répondeur automatique : jamais de réponse (anti-boucle)", async () => {
    const t = await setup();
    const { result } = await receive(t, { fromEmail: ALICE, subject: "Absence", bodyText: "Je suis absente", headers: { "auto-submitted": "auto-replied" } });
    expect(result?.decision).toBe("NO_REPLY");
    expect(await t.ctx.db.draftReply.count()).toBe(0);
  });

  it("un même fil reste dans le même ticket ; le nouveau message rend l'ancien brouillon obsolète", async () => {
    const t = await setup({});
    const first = await receive(t, { fromEmail: ALICE, subject: "Où est mon colis #1060 ?", bodyText: "?" });
    await receive(t, { fromEmail: ALICE, subject: "Re: Où est mon colis #1060 ?", bodyText: "Toujours rien", threadId: first.m.threadId, receivedAt: new Date(NOW.getTime() + 60_000) });
    expect(await t.ctx.db.ticket.count()).toBe(1);
    expect(await t.ctx.db.message.count()).toBe(2);
    expect((await t.ctx.db.draftReply.findMany({ orderBy: { createdAt: "asc" } })).map((d) => d.status)).toEqual(["SUPERSEDED", "DRAFT"]);
  });

  it("ingestion idempotente", async () => {
    const t = await setup();
    const { m } = await receive(t, { fromEmail: ALICE, subject: "Question", bodyText: "Bonjour" });
    expect((await ingestMessage(t.ctx, t.account.id, m.gmailMessageId)).outcome).toBe("duplicate");
    expect(await t.ctx.db.message.count()).toBe(1);
  });

  it("réponse faite à la main depuis Gmail : enregistrée, brouillons clos", async () => {
    const t = await setup({});
    const first = await receive(t, { fromEmail: ALICE, subject: "Question", bodyText: "Bonjour" });
    const reply = inbound({ fromEmail: SUPPORT_EMAIL, subject: "Re: Question", bodyText: "Réponse manuelle", threadId: first.m.threadId, labelIds: ["SENT"] });
    t.gmail.messages.set(reply.gmailMessageId, reply);
    expect((await ingestMessage(t.ctx, t.account.id, reply.gmailMessageId)).outcome).toBe("outbound");
    expect((await t.ctx.db.ticket.findFirstOrThrow()).status).toBe("REPLIED");
    expect((await t.ctx.db.draftReply.findFirstOrThrow()).status).toBe("SUPERSEDED");
  });

  it("droit à l'effacement : toutes les données du client sont supprimées", async () => {
    const t = await setup();
    await receive(t, { fromEmail: ALICE, subject: "Retour iPhone", bodyText: "Je me rétracte" });
    const c = await t.ctx.db.customer.findUniqueOrThrow({ where: { email: ALICE } });
    expect(await eraseCustomer(t.ctx, c.id, { type: "USER", id: "u1" }, "demande client")).toBe(true);
    expect(await t.ctx.db.ticket.count()).toBe(0);
    expect(await t.ctx.db.message.count()).toBe(0);
    expect(await t.ctx.db.document.count()).toBe(0);
    expect(await t.ctx.db.order.count({ where: { email: ALICE } })).toBe(0);
    const log = await t.ctx.db.auditLog.findFirstOrThrow({ where: { action: "customer.erased" } });
    expect(JSON.stringify(log.details)).not.toContain(ALICE);
  });
});
