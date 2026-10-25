/**
 * Outils d'administration en ligne de commande.
 *   pnpm cli status                      état des boîtes, files, intégrations
 *   pnpm cli sync                        synchronise toutes les boîtes Gmail
 *   pnpm cli reprocess <messageId>       relance l'analyse d'un message
 *   pnpm cli shopify:check               teste la connexion Shopify
 *   pnpm cli shopify:webhooks            abonne l'app Shopify aux webhooks
 *   pnpm cli retention                   applique la durée de conservation
 *   pnpm cli rotate-key                  rechiffre les secrets avec la nouvelle ENCRYPTION_KEY
 */
import { applyRetention, createContext, renewAllWatches, syncAccount } from "@ms/app";
import { disconnectDb, secretBox } from "@ms/db";
import { SHOPIFY_WEBHOOK_TOPICS } from "@ms/integrations";

const ctx = createContext();
const [cmd, arg] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case "status": {
      const accounts = await ctx.db.gmailAccount.findMany();
      console.table(accounts.map((a) => ({ email: a.email, actif: a.active, historyId: a.historyId, watchExpire: a.watchExpiresAt?.toISOString(), derniereSync: a.lastSyncAt?.toISOString() })));
      for (const q of ctx.queues.all()) console.log(q.name, await q.getJobCounts());
      console.log("Shopify :", ctx.shopify ? "configuré" : "non configuré");
      return;
    }
    case "sync": {
      for (const a of await ctx.db.gmailAccount.findMany({ where: { active: true } })) console.log(a.email, await syncAccount(ctx, a.id));
      return;
    }
    case "watch":
      await renewAllWatches(ctx);
      console.log("watch renouvelé");
      return;
    case "reprocess":
      if (!arg) throw new Error("usage : reprocess <messageId>");
      await ctx.queues.enqueueProcess(arg, { force: true });
      console.log("mis en file");
      return;
    case "shopify:check": {
      if (!ctx.shopify) throw new Error("Shopify non configuré (SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET)");
      console.log(await ctx.shopify.shopInfo());
      return;
    }
    case "shopify:webhooks": {
      if (!ctx.shopify) throw new Error("Shopify non configuré");
      const url = `${ctx.env.APP_BASE_URL}/webhooks/shopify`;
      console.log("Abonnements créés :", await ctx.shopify.ensureWebhooks(url, SHOPIFY_WEBHOOK_TOPICS), "→", url);
      return;
    }
    case "retention":
      console.log(await applyRetention(ctx));
      return;
    case "rotate-key": {
      const box = secretBox();
      let n = 0;
      for (const a of await ctx.db.gmailAccount.findMany()) {
        if (a.encryptedRefreshToken && box.needsRotation(a.encryptedRefreshToken)) {
          await ctx.db.gmailAccount.update({ where: { id: a.id }, data: { encryptedRefreshToken: box.encrypt(box.decrypt(a.encryptedRefreshToken)) } });
          n++;
        }
      }
      await ctx.db.integrationCredential.deleteMany({}); // jetons temporaires : simplement redemandés
      console.log(`${n} secret(s) rechiffré(s). Vous pouvez retirer ENCRYPTION_KEY_PREVIOUS.`);
      return;
    }
    default:
      console.log("Commandes : status | sync | watch | reprocess <id> | shopify:check | shopify:webhooks | retention | rotate-key");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ctx.queues.close();
    await ctx.queues.connection.quit();
    await disconnectDb();
  });
