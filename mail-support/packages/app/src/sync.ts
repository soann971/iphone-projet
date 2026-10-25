import { logger } from "@ms/shared";
import type { AppContext } from "./context";

/**
 * Synchronisation incrémentale d'une boîte via l'historique Gmail.
 * Chaque nouveau message est mis en file d'ingestion (dédupliqué par son id Gmail).
 */
export async function syncAccount(ctx: AppContext, accountId: string): Promise<{ enqueued: number; resync: boolean }> {
  const account = await ctx.db.gmailAccount.findUniqueOrThrow({ where: { id: accountId } });
  const { service } = await ctx.gmail(accountId);

  let ids: string[] = [];
  let newHistoryId: string | null = null;
  let resync = false;

  if (account.historyId) {
    const h = await service.listHistory(account.historyId);
    if (h.expired) resync = true;
    else {
      ids = h.messageIds;
      newHistoryId = h.newHistoryId;
    }
  } else resync = true;

  if (resync) {
    // Curseur absent ou trop ancien : on rattrape les 3 derniers jours de la boîte de réception.
    logger.warn({ account: account.email }, "resynchronisation complète (curseur Gmail expiré)");
    ids = await service.listMessageIds("in:inbox newer_than:3d", 500);
    newHistoryId = (await service.getProfile()).historyId;
  }

  for (const id of ids) await ctx.queues.enqueueIngest(accountId, id);

  await ctx.db.gmailAccount.update({
    where: { id: accountId },
    data: { historyId: newHistoryId ?? account.historyId, lastSyncAt: ctx.now() },
  });
  return { enqueued: ids.length, resync };
}

/**
 * Filet de sécurité : si une notification Pub/Sub s'est perdue, on rattrape les messages récents
 * non encore enregistrés (exécuté toutes les 10 minutes).
 */
export async function catchUp(ctx: AppContext) {
  const accounts = await ctx.db.gmailAccount.findMany({ where: { active: true } });
  for (const a of accounts) {
    try {
      await syncAccount(ctx, a.id);
      const { service } = await ctx.gmail(a.id);
      const recent = await service.listMessageIds("in:inbox newer_than:1d", 200);
      const known = await ctx.db.message.findMany({ where: { gmailMessageId: { in: recent } }, select: { gmailMessageId: true } });
      const knownSet = new Set(known.map((k) => k.gmailMessageId));
      for (const id of recent) if (!knownSet.has(id)) await ctx.queues.enqueueIngest(a.id, id);
    } catch (err) {
      logger.error({ err, account: a.email }, "rattrapage impossible");
    }
  }
}
