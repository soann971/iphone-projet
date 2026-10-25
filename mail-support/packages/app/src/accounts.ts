import { audit, secretBox } from "@ms/db";
import { GmailService, type ExchangedTokens } from "@ms/gmail";
import { logger } from "@ms/shared";
import type { AppContext } from "./context";
import { ALL_LABELS } from "./labels";

/** Enregistre (ou met à jour) une boîte après le consentement OAuth, crée les libellés et active le watch. */
export async function connectGmailAccount(ctx: AppContext, tokens: ExchangedTokens, userId: string) {
  const service = new GmailService(ctx.google, tokens.refreshToken);
  const profile = await service.getProfile();
  const labelIds = await service.ensureLabels(ALL_LABELS);
  const account = await ctx.db.gmailAccount.upsert({
    where: { email: tokens.email },
    create: {
      email: tokens.email,
      encryptedRefreshToken: secretBox().encrypt(tokens.refreshToken),
      scopes: tokens.scopes,
      historyId: profile.historyId,
      labelIds,
    },
    update: {
      encryptedRefreshToken: secretBox().encrypt(tokens.refreshToken),
      scopes: tokens.scopes,
      labelIds,
      active: true,
    },
  });
  await audit(ctx.db, { actorType: "USER", actorId: userId, action: "gmail.connected", entityType: "GmailAccount", entityId: account.id, details: { email: tokens.email } });
  await renewWatch(ctx, account.id);
  return account;
}

/** (Re)active les notifications Pub/Sub d'une boîte. Expire après 7 jours : renouvelé chaque jour. */
export async function renewWatch(ctx: AppContext, accountId: string) {
  if (!ctx.env.GMAIL_PUBSUB_TOPIC) {
    logger.warn("GMAIL_PUBSUB_TOPIC non défini : réception par interrogation périodique uniquement");
    return null;
  }
  const { service } = await ctx.gmail(accountId);
  const res = await service.watch(ctx.env.GMAIL_PUBSUB_TOPIC);
  const account = await ctx.db.gmailAccount.findUniqueOrThrow({ where: { id: accountId } });
  await ctx.db.gmailAccount.update({
    where: { id: accountId },
    data: {
      watchExpiresAt: res.expiration,
      // On ne recule jamais le curseur : il ne sert qu'à initialiser une boîte neuve.
      historyId: account.historyId ?? res.historyId,
    },
  });
  return res;
}

export async function renewAllWatches(ctx: AppContext) {
  const accounts = await ctx.db.gmailAccount.findMany({ where: { active: true } });
  for (const a of accounts) {
    try {
      await renewWatch(ctx, a.id);
    } catch (err) {
      logger.error({ err, account: a.email }, "renouvellement du watch Gmail impossible");
    }
  }
}

export async function disconnectGmailAccount(ctx: AppContext, accountId: string, userId: string) {
  try {
    const { service } = await ctx.gmail(accountId);
    await service.stop();
  } catch (err) {
    logger.warn({ err }, "arrêt du watch impossible (déjà révoqué ?)");
  }
  await ctx.db.gmailAccount.update({ where: { id: accountId }, data: { active: false, encryptedRefreshToken: "" } });
  await audit(ctx.db, { actorType: "USER", actorId: userId, action: "gmail.disconnected", entityType: "GmailAccount", entityId: accountId });
}
