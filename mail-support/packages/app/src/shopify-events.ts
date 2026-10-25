import { audit } from "@ms/db";
import { logger } from "@ms/shared";
import type { AppContext } from "./context";
import type { ShopifyJob } from "./queues";
import { upsertOrder } from "./orders";
import { eraseCustomer } from "./privacy";

/** Traite un webhook Shopify (mis en file par l'API après vérification HMAC). */
export async function handleShopifyEvent(ctx: AppContext, job: ShopifyJob) {
  switch (job.topic) {
    case "orders/create":
    case "orders/updated":
    case "fulfillments/create":
    case "fulfillments/update": {
      if (!ctx.shopify || !job.orderId) return;
      const order = await ctx.shopify.orderById(job.orderId);
      if (order) await upsertOrder(ctx.db, order);
      return;
    }
    case "customers/redact": {
      // Demande d'effacement transmise par Shopify (RGPD).
      if (!job.customerEmail) return;
      const c = await ctx.db.customer.findUnique({ where: { email: job.customerEmail.toLowerCase() } });
      if (c) await eraseCustomer(ctx, c.id, { type: "SYSTEM" }, "demande Shopify customers/redact");
      return;
    }
    case "customers/data_request": {
      // L'export se fait depuis le dashboard : on trace la demande pour traitement.
      await audit(ctx.db, { actorType: "SYSTEM", action: "shopify.data_request", entityType: "Customer", entityId: job.customerEmail ?? "inconnu" });
      return;
    }
    default:
      logger.info({ topic: job.topic }, "webhook Shopify ignoré");
  }
}
