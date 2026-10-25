import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "@ms/app";
import { decodePushBody, verifyPushToken } from "@ms/gmail";
import { verifyShopifyWebhook } from "@ms/integrations";

/** Enregistre un identifiant d'événement ; false s'il a déjà été traité (idempotence). */
async function firstTime(ctx: AppContext, id: string): Promise<boolean> {
  try {
    await ctx.db.processedEvent.create({ data: { id } });
    return true;
  } catch {
    return false;
  }
}

export const webhookRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    // Corps brut nécessaire à la vérification HMAC Shopify.
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

    /** Notifications Gmail poussées par Google Cloud Pub/Sub. */
    app.post("/webhooks/gmail", async (req, reply) => {
      const env = ctx.env;
      if (!env.PUBSUB_SKIP_VERIFY) {
        try {
          await verifyPushToken(req.headers.authorization, env.PUBSUB_AUDIENCE || `${env.APP_BASE_URL}/webhooks/gmail`, env.PUBSUB_SERVICE_ACCOUNT);
        } catch (err) {
          req.log.warn({ err: (err as Error).message }, "push Pub/Sub refusé");
          return reply.code(401).send();
        }
      }
      let n;
      try {
        n = decodePushBody(JSON.parse((req.body as Buffer).toString("utf8")));
      } catch {
        return reply.code(204).send(); // message illisible : acquitté pour ne pas boucler
      }
      if (n.pubsubMessageId && !(await firstTime(ctx, `pubsub:${n.pubsubMessageId}`))) return reply.code(204).send();
      const account = await ctx.db.gmailAccount.findUnique({ where: { email: n.emailAddress } });
      if (account?.active) await ctx.queues.enqueueSync(account.id, n.historyId);
      return reply.code(204).send();
    });

    /** Webhooks Shopify (commandes, expéditions, RGPD). */
    app.post("/webhooks/shopify", async (req, reply) => {
      const raw = req.body as Buffer;
      const secret = ctx.env.SHOPIFY_WEBHOOK_SECRET || ctx.env.SHOPIFY_CLIENT_SECRET;
      if (!verifyShopifyWebhook(raw, req.headers["x-shopify-hmac-sha256"] as string | undefined, secret)) {
        return reply.code(401).send();
      }
      const webhookId = req.headers["x-shopify-webhook-id"] as string | undefined;
      if (webhookId && !(await firstTime(ctx, `shopify:${webhookId}`))) return reply.code(200).send();
      const topic = String(req.headers["x-shopify-topic"] ?? "");
      const payload = JSON.parse(raw.toString("utf8")) as {
        admin_graphql_api_id?: string;
        order_id?: number;
        customer?: { email?: string };
        email?: string;
      };
      const orderId = topic.startsWith("orders/") ? payload.admin_graphql_api_id : payload.order_id ? `gid://shopify/Order/${payload.order_id}` : undefined;
      await ctx.queues.shopify.add(topic, { topic, orderId, customerEmail: payload.customer?.email ?? payload.email });
      return reply.code(200).send();
    });
  };
