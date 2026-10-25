import type { Db } from "@ms/db";
import type { ShopOrder } from "@ms/integrations";
import { fromShopifyDisplayStatus } from "@ms/integrations";

/** Ligne de commande telle que stockée dans Order.lineItems. */
export interface StoredLineItem {
  id: string;
  title: string;
  sku: string | null;
  quantity: number;
  variantId: string | null;
  productId: string | null;
  warrantyMonths: number | null;
  fulfillmentLineItems: { id: string; quantity: number }[];
}

/** Met à jour le cache local d'une commande Shopify et de ses expéditions. */
export async function upsertOrder(db: Db, o: ShopOrder) {
  const customer = o.email ? await db.customer.findUnique({ where: { email: o.email }, select: { id: true } }) : null;
  const lineItems: StoredLineItem[] = o.lineItems;
  const order = await db.order.upsert({
    where: { shopifyId: o.shopifyId },
    create: {
      shopifyId: o.shopifyId,
      name: o.name,
      email: o.email,
      customerId: customer?.id ?? null,
      currency: o.currency,
      totalPrice: o.totalPrice,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      orderedAt: o.createdAt,
      cancelledAt: o.cancelledAt,
      lineItems: lineItems as never,
    },
    update: {
      name: o.name,
      email: o.email,
      customerId: customer?.id ?? undefined,
      currency: o.currency,
      totalPrice: o.totalPrice,
      financialStatus: o.financialStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      cancelledAt: o.cancelledAt,
      lineItems: lineItems as never,
      syncedAt: new Date(),
    },
  });
  for (const f of o.fulfillments) {
    const t = f.tracking[0];
    const status = f.deliveredAt ? "DELIVERED" : fromShopifyDisplayStatus(f.displayStatus);
    await db.shipment.upsert({
      where: { shopifyFulfillmentId: f.id },
      create: {
        orderId: order.id,
        shopifyFulfillmentId: f.id,
        carrier: t?.company ?? null,
        trackingNumber: t?.number ?? null,
        trackingUrl: t?.url ?? null,
        status,
        shippedAt: f.inTransitAt ?? f.createdAt,
        deliveredAt: f.deliveredAt,
      },
      update: {
        carrier: t?.company ?? null,
        trackingNumber: t?.number ?? null,
        trackingUrl: t?.url ?? null,
        // On ne dégrade pas un statut "livré" obtenu auprès du transporteur.
        ...(f.deliveredAt || status !== "UNKNOWN" ? { status } : {}),
        ...(f.deliveredAt ? { deliveredAt: f.deliveredAt } : {}),
      },
    });
  }
  return order;
}
