import type { Category } from "@ms/shared";

/**
 * Faits VÉRIFIÉS (issus de Shopify, des transporteurs, de la base et des calculs du code).
 * C'est la seule source d'information que l'IA a le droit d'utiliser pour rédiger.
 * Les valeurs sont déjà formatées pour le client (dates "12 mars 2026", montants "49,90 €").
 */
export interface VerifiedFacts {
  shop: { name: string; url: string; supportEmail: string };
  customer: { name: string | null; email: string; knownInShopify: boolean; ordersCount: number };
  category: Category;
  order?: {
    name: string;
    date: string;
    total: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    cancelled: boolean;
    items: { title: string; quantity: number }[];
  };
  /** Autres commandes du client (si aucune commande précise n'est identifiée). */
  recentOrders?: { name: string; date: string; total: string }[];
  shipments?: {
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    status: string;
    statusLabel: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    lastEvent: string | null;
  }[];
  warranty?: {
    product: string;
    months: number;
    startDate: string | null;
    expiresAt: string | null;
    eligible: boolean | null;
    reason: string;
  };
  return?: {
    eligible: boolean | null;
    reason: string;
    deadline: string | null;
    rmaNumber: string | null;
    procedureAttached: boolean;
    returnAddress: string;
    shippingCostText: string;
  };
  quote?: {
    number: string;
    lines: { title: string; quantity: number; unitPrice: string; total: string }[];
    totalTtc: string;
    validUntil: string;
    paymentUrl: string | null;
    pdfAttached: boolean;
    unmatchedProducts: string[];
  };
  knowledge?: { title: string; content: string }[];
  /** Ce qui manque pour traiter la demande : l'IA doit le demander au client. */
  missing: string[];
  /** Signaux pour le moteur de décision (jamais montrés au client). */
  flags: FactFlag[];
  /** Montant en jeu (€), pour le seuil de validation. */
  amountInvolved: number | null;
}

export type FactFlag =
  | "IDENTITY_MISMATCH"
  | "ORDER_NOT_FOUND"
  | "WARRANTY_REFUSED"
  | "WARRANTY_UNDETERMINED"
  | "RETURN_OUT_OF_WINDOW"
  | "RETURN_UNDETERMINED"
  | "QUOTE_INCOMPLETE"
  | "SHOPIFY_UNAVAILABLE"
  | "TRACKING_UNAVAILABLE"
  | "ORDER_CANCELLED"
  | "NO_KNOWLEDGE";

/** Toutes les valeurs que la réponse a le droit de citer (pour le garde-fou). */
export function allowedLiteralsFromFacts(f: VerifiedFacts): string[] {
  const out: (string | null | undefined)[] = [f.shop.url, f.shop.supportEmail, f.customer.email, f.customer.name];
  if (f.order) {
    out.push(f.order.name, f.order.name.replace("#", ""), f.order.date, f.order.total);
  }
  for (const o of f.recentOrders ?? []) out.push(o.name, o.date, o.total);
  for (const s of f.shipments ?? []) out.push(s.trackingNumber, s.trackingUrl, s.shippedAt, s.deliveredAt, s.lastEvent);
  if (f.warranty) out.push(f.warranty.startDate, f.warranty.expiresAt, String(f.warranty.months));
  if (f.return) out.push(f.return.deadline, f.return.rmaNumber, f.return.returnAddress, f.return.shippingCostText);
  if (f.quote) {
    out.push(f.quote.number, f.quote.totalTtc, f.quote.validUntil, f.quote.paymentUrl);
    for (const l of f.quote.lines) out.push(l.unitPrice, l.total);
  }
  for (const k of f.knowledge ?? []) out.push(k.content);
  return out.filter((v): v is string => typeof v === "string" && v.length > 0);
}
