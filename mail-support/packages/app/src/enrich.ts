import {
  allowedLiteralsFromFacts,
  computeReturnEligibility,
  computeWarranty,
  extractOrderRefs,
  formatDateFr,
  formatEuro,
  type VerifiedFacts,
} from "@ms/core";
import { audit, nextNumber, type Customer, type Message, type Order, type Ticket } from "@ms/db";
import { CARRIER_DOMAINS, matchVariant, resolveShipment, STATUS_LABELS_FR, type ShopOrder } from "@ms/integrations";
import { quoteTotals, renderQuotePdf, renderReturnPdf } from "@ms/pdf";
import { logger, TransientError, type Analysis, type Settings } from "@ms/shared";
import type { AppContext } from "./context";
import { upsertOrder, type StoredLineItem } from "./orders";

export interface EnrichInput {
  ticket: Ticket;
  customer: Customer;
  message: Message;
  analysis: Analysis;
  settings: Settings;
  accountEmail: string;
  /** Numéro de tentative du job : les erreurs Shopify passagères sont réessayées avant d'abandonner. */
  attempt: number;
}

export interface EnrichResult {
  facts: VerifiedFacts;
  allowedLiterals: string[];
  allowedDomains: string[];
  documentIds: string[];
  orderId: string | null;
  /** Retour à créer dans Shopify lors de l'envoi de la réponse. */
  returnRequestId: string | null;
}

const NEEDS_ORDER = new Set(["ORDER", "SHIPPING", "RETURN", "WARRANTY"]);

const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);

/** Lignes de commande correspondant aux produits cités par le client. */
function matchLines(lines: StoredLineItem[], products: { name: string }[]): StoredLineItem[] {
  if (!products.length) return [];
  return lines.filter((l) => {
    const lt = new Set(tokens(l.title));
    return products.some((p) => {
      const pt = tokens(p.name);
      return pt.length > 0 && pt.filter((t) => lt.has(t)).length / pt.length >= 0.6;
    });
  });
}

/**
 * Construit les FAITS VÉRIFIÉS pour un message : commande Shopify (avec contrôle d'identité),
 * suivi de colis, éligibilité garantie/retour (calculées par le code), devis (prix du catalogue).
 * Crée au passage les dossiers associés (garantie, retour, devis) et les PDF.
 */
export async function buildFacts(ctx: AppContext, i: EnrichInput): Promise<EnrichResult> {
  const { settings, analysis, customer, ticket, message } = i;
  const category = analysis.category;
  const facts: VerifiedFacts = {
    shop: { name: settings.shopName, url: settings.shopUrl, supportEmail: i.accountEmail },
    customer: { name: analysis.extracted.customerName ?? customer.name, email: customer.email, knownInShopify: false, ordersCount: 0 },
    category,
    missing: [],
    flags: [],
    amountInvolved: null,
  };
  const documentIds: string[] = [];
  let returnRequestId: string | null = null;
  const addMissing = (m: string) => facts.missing.includes(m) || facts.missing.push(m);

  // ---------- Shopify : client et commandes ----------
  let orders: ShopOrder[] = [];
  let order: ShopOrder | null = null;
  let orderRow: Order | null = null;
  const shopify = ctx.shopify;

  const shopifyCall = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TransientError && i.attempt < 3) throw err;
      logger.warn({ err: (err as Error).message }, "Shopify indisponible");
      if (!facts.flags.includes("SHOPIFY_UNAVAILABLE")) facts.flags.push("SHOPIFY_UNAVAILABLE");
      return null;
    }
  };

  if (shopify && category !== "SPAM") {
    const sc = await shopifyCall(() => shopify.findCustomerByEmail(customer.email));
    if (sc) {
      facts.customer.knownInShopify = true;
      facts.customer.ordersCount = sc.numberOfOrders;
      facts.customer.name = facts.customer.name ?? sc.firstName ?? sc.displayName;
      if (!customer.shopifyCustomerId) {
        await ctx.db.customer.update({ where: { id: customer.id }, data: { shopifyCustomerId: sc.id } }).catch(() => undefined);
      }
    }
    orders = (await shopifyCall(() => shopify.ordersByEmail(customer.email, 10))) ?? [];
    if (orders.length) facts.customer.knownInShopify = true;

    // Numéros de commande cités (IA + extraction déterministe).
    const refs = [...new Set([...analysis.extracted.orderNumbers.map((r) => `#${r.replace(/^#/, "").trim()}`), ...extractOrderRefs(`${message.subject}\n${message.bodyText}`)])];
    for (const ref of refs) {
      const own = orders.find((o) => o.name === ref);
      if (own) {
        order = own;
        break;
      }
      const found = await shopifyCall(() => shopify.orderByName(ref));
      if (found) {
        // Commande existante mais d'un autre client : on ne divulgue RIEN.
        facts.flags.push("IDENTITY_MISMATCH");
        addMissing("l'adresse email utilisée lors de la commande (pour des raisons de sécurité, nous ne pouvons communiquer d'informations qu'au titulaire de la commande)");
        break;
      }
    }
    if (!order && !facts.flags.includes("IDENTITY_MISMATCH")) {
      if (ticket.orderId) {
        const prev = await ctx.db.order.findUnique({ where: { id: ticket.orderId } });
        order = orders.find((o) => o.shopifyId === prev?.shopifyId) ?? null;
      }
      if (!order && orders.length === 1) order = orders[0]!;
      if (!order && orders.length > 1 && category === "SHIPPING") {
        const undelivered = orders.filter((o) => !o.cancelledAt && !o.fulfillments.some((f) => f.deliveredAt));
        if (undelivered.length === 1) order = undelivered[0]!;
      }
    }
    if (order) orderRow = await upsertOrder(ctx.db, order);
  }

  if (!order && NEEDS_ORDER.has(category) && !facts.flags.includes("IDENTITY_MISMATCH")) {
    if (orders.length > 1) {
      facts.recentOrders = orders.slice(0, 5).map((o) => ({ name: o.name, date: formatDateFr(o.createdAt), total: formatEuro(o.totalPrice, o.currency) }));
      addMissing("le numéro de la commande concernée");
    } else {
      addMissing("le numéro de commande (et l'adresse email utilisée pour la commande si elle est différente)");
      if (shopify && !orders.length) facts.flags.push("ORDER_NOT_FOUND");
    }
  }

  // ---------- Commande et expéditions ----------
  if (order) {
    facts.order = {
      name: order.name,
      date: formatDateFr(order.createdAt),
      total: formatEuro(order.totalPrice, order.currency),
      paymentStatus: order.financialStatus ?? "inconnu",
      fulfillmentStatus: order.fulfillmentStatus ?? "inconnu",
      cancelled: !!order.cancelledAt,
      items: order.lineItems.map((l) => ({ title: l.title, quantity: l.quantity })),
    };
    if (order.cancelledAt) facts.flags.push("ORDER_CANCELLED");
    facts.amountInvolved = order.totalPrice;

    if (["SHIPPING", "ORDER", "RETURN"].includes(category) && order.fulfillments.length) {
      facts.shipments = [];
      for (const f of order.fulfillments.slice(0, 3)) {
        const t = f.tracking[0];
        const r = await resolveShipment(
          { company: t?.company ?? null, trackingNumber: t?.number ?? null, trackingUrl: t?.url ?? null, shopifyDisplayStatus: f.displayStatus, shopifyDeliveredAt: f.deliveredAt },
          ctx.trackers,
        );
        if (r.status === "UNKNOWN" && t?.number && r.source === "shopify") facts.flags.includes("TRACKING_UNAVAILABLE") || facts.flags.push("TRACKING_UNAVAILABLE");
        facts.shipments.push({
          carrier: r.carrier,
          trackingNumber: t?.number ?? null,
          trackingUrl: r.trackingUrl,
          status: r.status,
          statusLabel: r.status === "UNKNOWN" ? STATUS_LABELS_FR.UNKNOWN : r.label,
          shippedAt: formatDateFr(f.inTransitAt ?? f.createdAt),
          deliveredAt: r.deliveredAt ? formatDateFr(r.deliveredAt) : null,
          lastEvent: r.lastEvent ? `${formatDateFr(r.lastEvent.date)} : ${r.lastEvent.label}` : null,
        });
        if (r.source !== "shopify" && orderRow) {
          await ctx.db.shipment.updateMany({
            where: { shopifyFulfillmentId: f.id },
            data: { status: r.status, statusLabel: r.label, deliveredAt: r.deliveredAt ?? undefined, lastCheckedAt: ctx.now(), events: r.events as never },
          });
        }
        // Livraison confirmée par le transporteur : utile au calcul du délai de retour.
        if (r.deliveredAt && !f.deliveredAt) f.deliveredAt = r.deliveredAt;
      }
    } else if (category === "SHIPPING") {
      facts.shipments = [];
    }
  }

  // ---------- Garantie ----------
  if (category === "WARRANTY" && order) {
    const lines = order.lineItems;
    const matched = matchLines(lines, analysis.extracted.products);
    const line = matched[0] ?? (lines.length === 1 ? lines[0] : undefined);
    if (!line) {
      addMissing("le produit concerné par la demande de garantie");
      facts.flags.push("WARRANTY_UNDETERMINED");
    } else {
      const months = line.warrantyMonths ?? settings.defaultWarrantyMonths;
      const delivered = order.fulfillments.find((f) => f.deliveredAt)?.deliveredAt ?? null;
      const w = computeWarranty({ purchaseDate: order.createdAt, deliveredAt: delivered, warrantyMonths: months, now: message.receivedAt });
      facts.warranty = {
        product: line.title,
        months,
        startDate: w.startDate ? formatDateFr(w.startDate) : null,
        expiresAt: w.expiresAt ? formatDateFr(w.expiresAt) : null,
        eligible: w.eligible,
        reason: w.reason,
      };
      if (w.eligible === false) facts.flags.push("WARRANTY_REFUSED");
      if (w.eligible === null) facts.flags.push("WARRANTY_UNDETERMINED");
      if (!analysis.extracted.issueDescription) addMissing("une description précise du problème rencontré");
      const already = await ctx.db.warrantyClaim.findFirst({ where: { ticketId: ticket.id, createdAt: { gte: message.createdAt } } });
      if (!already) await ctx.db.warrantyClaim.create({
        data: {
          ticketId: ticket.id,
          orderId: orderRow?.id ?? null,
          productTitle: line.title,
          serialNumber: analysis.extracted.serialNumbers[0] ?? null,
          purchaseDate: order.createdAt,
          warrantyMonths: months,
          expiresAt: w.expiresAt,
          eligible: w.eligible,
          reason: w.reason,
          issueDescription: analysis.extracted.issueDescription,
        },
      });
    }
  }

  // ---------- Retour (rétractation 14 jours) ----------
  if (category === "RETURN" && order) {
    const deliveredAt = order.fulfillments.map((f) => f.deliveredAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const r = computeReturnEligibility({
      orderedAt: order.createdAt,
      deliveredAt,
      windowDays: settings.returnWindowDays,
      requestedAt: message.receivedAt,
      cancelled: !!order.cancelledAt,
    });
    const matched = matchLines(order.lineItems, analysis.extracted.products);
    const items = (matched.length ? matched : order.lineItems).map((l) => ({ title: l.title, quantity: l.quantity, lineItemId: l.id, fulfillmentLineItems: l.fulfillmentLineItems }));
    if (r.eligible === false) facts.flags.push("RETURN_OUT_OF_WINDOW");
    if (r.eligible === null) facts.flags.push("RETURN_UNDETERMINED");

    let rmaNumber: string | null = null;
    let procedureAttached = false;
    // Job rejoué : on réutilise le dossier déjà créé pour ce message (pas de double numéro ni de double PDF).
    const prior = await ctx.db.returnRequest.findFirst({ where: { ticketId: ticket.id, createdAt: { gte: message.createdAt } } });
    if (prior) {
      rmaNumber = prior.eligible ? prior.rmaNumber : null;
      if (prior.documentId) {
        documentIds.push(prior.documentId);
        procedureAttached = true;
      }
      if (prior.eligible) returnRequestId = prior.id;
    } else if (r.eligible === true) {
      rmaNumber = await nextNumber(ctx.db, "RET", ctx.now());
      const pdf = await renderReturnPdf({
        rmaNumber,
        date: ctx.now(),
        company: settings.company,
        customer: { name: facts.customer.name, email: customer.email },
        orderName: order.name,
        items,
        deadline: r.deadline,
        returnAddress: settings.returnAddress,
        shippingCostText: settings.returnShippingCostText,
        reason: analysis.extracted.returnReason,
      });
      const doc = await saveDocument(ctx, ticket.id, "RETURN_PROCEDURE_PDF", `procedure-retour-${rmaNumber}.pdf`, pdf);
      documentIds.push(doc.id);
      procedureAttached = true;
      const rr = await ctx.db.returnRequest.create({
        data: {
          ticketId: ticket.id,
          orderId: orderRow?.id ?? null,
          rmaNumber,
          items: items as never,
          reason: analysis.extracted.returnReason,
          deliveredAt,
          deadline: r.deadline,
          eligible: true,
          eligibilityReason: r.reason,
          documentId: doc.id,
        },
      });
      returnRequestId = rr.id;
    } else {
      await ctx.db.returnRequest.create({
        data: {
          ticketId: ticket.id,
          orderId: orderRow?.id ?? null,
          rmaNumber: await nextNumber(ctx.db, "RET", ctx.now()),
          items: items as never,
          reason: analysis.extracted.returnReason,
          deliveredAt,
          deadline: r.deadline,
          eligible: r.eligible,
          eligibilityReason: r.reason,
          status: "PENDING_REVIEW",
        },
      });
    }
    facts.return = {
      eligible: r.eligible,
      reason: r.reason,
      deadline: r.deadline ? formatDateFr(r.deadline) : null,
      rmaNumber,
      procedureAttached,
      returnAddress: settings.returnAddress,
      shippingCostText: settings.returnShippingCostText,
    };
  }

  // ---------- Devis ----------
  if (category === "QUOTE") {
    const requested = analysis.extracted.products;
    if (!requested.length) {
      addMissing("la liste des produits souhaités et les quantités");
    } else if (!shopify) {
      facts.flags.push("QUOTE_INCOMPLETE");
    } else {
      const matchedLines: { title: string; sku: string | null; variantId: string; quantity: number; unitPriceTtc: number }[] = [];
      const unmatched: string[] = [];
      for (const p of requested.slice(0, 20)) {
        const candidates = (await shopifyCall(() => shopify.searchVariants(p.name))) ?? [];
        const v = matchVariant(p.name, candidates);
        if (v && v.availableForSale) {
          matchedLines.push({ title: v.displayName, sku: v.sku, variantId: v.variantId, quantity: Math.max(1, Math.round(p.quantity ?? 1)), unitPriceTtc: v.price });
        } else unmatched.push(p.name);
      }
      if (unmatched.length || !matchedLines.length) facts.flags.push("QUOTE_INCOMPLETE");

      const priorQuote = await ctx.db.quote.findFirst({ where: { ticketId: ticket.id, createdAt: { gte: message.createdAt } } });
      if (priorQuote && !unmatched.length) {
        const lines = priorQuote.lines as { title: string; quantity: number; unitPriceTtc: number }[];
        if (priorQuote.documentId) documentIds.push(priorQuote.documentId);
        facts.amountInvolved = Number(priorQuote.totalTtc);
        facts.quote = {
          number: priorQuote.number,
          lines: lines.map((l) => ({ title: l.title, quantity: l.quantity, unitPrice: formatEuro(l.unitPriceTtc), total: formatEuro(l.unitPriceTtc * l.quantity) })),
          totalTtc: formatEuro(Number(priorQuote.totalTtc)),
          validUntil: formatDateFr(priorQuote.validUntil),
          paymentUrl: priorQuote.invoiceUrl,
          pdfAttached: !!priorQuote.documentId,
          unmatchedProducts: [],
        };
      } else if (matchedLines.length && !unmatched.length) {
        const number = await nextNumber(ctx.db, "DEV", ctx.now());
        const validUntil = new Date(ctx.now().getTime() + settings.quoteValidityDays * 86_400_000);
        const totals = quoteTotals(matchedLines, settings.vatRate);
        let paymentUrl: string | null = null;
        let draftOrderId: string | null = null;
        if (settings.shopifyCreateDraftOrders) {
          const d = await shopifyCall(() =>
            shopify.createDraftOrder({
              email: customer.email,
              lines: matchedLines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
              note: `Devis ${number} (ticket #${ticket.number})`,
              tags: ["devis", number],
            }),
          );
          paymentUrl = d?.invoiceUrl ?? null;
          draftOrderId = d?.id ?? null;
        }
        const pdf = await renderQuotePdf({
          number,
          date: ctx.now(),
          validUntil,
          company: settings.company,
          customer: { name: facts.customer.name, email: customer.email },
          lines: matchedLines,
          vatRate: settings.vatRate,
          terms: settings.company.quoteTerms,
          paymentUrl,
        });
        const doc = await saveDocument(ctx, ticket.id, "QUOTE_PDF", `devis-${number}.pdf`, pdf);
        documentIds.push(doc.id);
        await ctx.db.quote.create({
          data: {
            number,
            ticketId: ticket.id,
            customerId: customer.id,
            lines: matchedLines as never,
            totalHt: totals.totalHt,
            totalVat: totals.totalVat,
            totalTtc: totals.totalTtc,
            validUntil,
            shopifyDraftOrderId: draftOrderId,
            invoiceUrl: paymentUrl,
            documentId: doc.id,
          },
        });
        facts.amountInvolved = totals.totalTtc;
        facts.quote = {
          number,
          lines: matchedLines.map((l) => ({ title: l.title, quantity: l.quantity, unitPrice: formatEuro(l.unitPriceTtc), total: formatEuro(l.unitPriceTtc * l.quantity) })),
          totalTtc: formatEuro(totals.totalTtc),
          validUntil: formatDateFr(validUntil),
          paymentUrl,
          pdfAttached: true,
          unmatchedProducts: [],
        };
      } else if (matchedLines.length || unmatched.length) {
        facts.quote = {
          number: "",
          lines: [],
          totalTtc: "",
          validUntil: "",
          paymentUrl: null,
          pdfAttached: false,
          unmatchedProducts: unmatched,
        };
      }
    }
  }

  // ---------- Base de connaissances ----------
  const knowledge = await ctx.db.knowledgeEntry.findMany({ where: { active: true }, orderBy: { title: "asc" }, take: 40 });
  if (knowledge.length) facts.knowledge = knowledge.map((k) => ({ title: k.title, content: k.content }));
  if (category === "INFO" && !knowledge.length) facts.missing.push("(aucune information de référence disponible : transmettre à un conseiller)");

  for (const m of analysis.missingInfo) addMissing(m);

  const domains = [hostOf(settings.shopUrl), ...settings.allowedLinkDomains, ...CARRIER_DOMAINS, "myshopify.com", ctx.shopify?.domain].filter(
    (d): d is string => !!d,
  );

  await audit(ctx.db, {
    actorType: "SYSTEM",
    action: "facts.built",
    entityType: "Ticket",
    entityId: ticket.id,
    details: { category, order: order?.name ?? null, flags: facts.flags, documents: documentIds.length },
  });

  return {
    facts,
    allowedLiterals: allowedLiteralsFromFacts(facts),
    allowedDomains: domains,
    documentIds,
    orderId: orderRow?.id ?? null,
    returnRequestId,
  };
}

async function saveDocument(ctx: AppContext, ticketId: string, kind: "QUOTE_PDF" | "RETURN_PROCEDURE_PDF", filename: string, content: Buffer) {
  const stored = await ctx.storage.save(content, filename);
  return ctx.db.document.create({ data: { kind, filename, ticketId, ...stored } });
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
