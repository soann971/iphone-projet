import { UnrecoverableError, Worker, type Job, type Processor } from "bullmq";
import {
  catchUp,
  createContext,
  handleShopifyEvent,
  ingestMessage,
  processMessage,
  QUEUE,
  renewAllWatches,
  sendDraft,
  syncAccount,
  applyRetention,
  type IngestJob,
  type MaintenanceJob,
  type ProcessJob,
  type SendJob,
  type ShopifyJob,
  type SyncJob,
} from "@ms/app";
import { audit, disconnectDb } from "@ms/db";
import { logger, PermanentError } from "@ms/shared";

process.env.SERVICE_NAME ??= "worker";
const ctx = createContext();
const connection = ctx.queues.connection;

/** Les erreurs définitives ne sont pas réessayées. */
function wrap<T>(name: string, fn: (job: Job<T>) => Promise<unknown>): Processor<T> {
  return async (job) => {
    try {
      const result = await fn(job);
      logger.debug({ queue: name, jobId: job.id, result }, "job terminé");
      return result;
    } catch (err) {
      if (err instanceof PermanentError) throw new UnrecoverableError(err.message);
      throw err;
    }
  };
}

const workers = [
  new Worker<SyncJob>(QUEUE.SYNC, wrap(QUEUE.SYNC, (j) => syncAccount(ctx, j.data.accountId)), { connection, concurrency: 2 }),
  new Worker<IngestJob>(QUEUE.INGEST, wrap(QUEUE.INGEST, (j) => ingestMessage(ctx, j.data.accountId, j.data.gmailMessageId)), { connection, concurrency: 5 }),
  new Worker<ProcessJob>(
    QUEUE.PROCESS,
    wrap(QUEUE.PROCESS, (j) => processMessage(ctx, j.data.messageId, { operatorNote: j.data.operatorNote, force: j.data.force, attempt: j.attemptsMade + 1 })),
    // Limite les appels simultanés à l'API Claude.
    { connection, concurrency: 3, limiter: { max: 30, duration: 60_000 } },
  ),
  new Worker<SendJob>(QUEUE.SEND, wrap(QUEUE.SEND, (j) => sendDraft(ctx, j.data.draftId)), { connection, concurrency: 2 }),
  new Worker<ShopifyJob>(QUEUE.SHOPIFY, wrap(QUEUE.SHOPIFY, (j) => handleShopifyEvent(ctx, j.data)), { connection, concurrency: 2 }),
  new Worker<MaintenanceJob>(
    QUEUE.MAINTENANCE,
    wrap(QUEUE.MAINTENANCE, async (j) => {
      switch (j.data.task) {
        case "renew-watch":
          return renewAllWatches(ctx);
        case "catch-up":
          return catchUp(ctx);
        case "retention":
          return applyRetention(ctx);
        default:
          return null;
      }
    }),
    { connection, concurrency: 1 },
  ),
];

for (const w of workers) {
  w.on("failed", async (job, err) => {
    const final = !job || err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    logger.error({ queue: w.name, jobId: job?.id, attempts: job?.attemptsMade, final, err: err.message }, "job en échec");
    if (!final || !job) return;
    // Échec définitif du traitement d'un message : le ticket passe en erreur, visible dans le dashboard.
    if (w.name === QUEUE.PROCESS) {
      const { messageId } = job.data as ProcessJob;
      const msg = await ctx.db.message.findUnique({ where: { id: messageId }, select: { ticketId: true } });
      if (msg) {
        await ctx.db.ticket.update({ where: { id: msg.ticketId }, data: { status: "ERROR", reviewReasons: [`Traitement impossible : ${err.message}`] } });
        await audit(ctx.db, { actorType: "SYSTEM", action: "ticket.processing_failed", entityType: "Ticket", entityId: msg.ticketId, details: { error: err.message } });
      }
    }
    if (w.name === QUEUE.SEND) {
      const { draftId } = job.data as SendJob;
      await ctx.db.draftReply.update({ where: { id: draftId }, data: { status: "FAILED", error: err.message } }).catch(() => undefined);
    }
  });
}

/** Tâches planifiées (idempotentes : upsert). */
async function schedule() {
  const m = ctx.queues.maintenance;
  await m.upsertJobScheduler("renew-watch", { pattern: "17 3 * * *" }, { name: "renew-watch", data: { task: "renew-watch" } });
  await m.upsertJobScheduler("catch-up", { every: 10 * 60_000 }, { name: "catch-up", data: { task: "catch-up" } });
  await m.upsertJobScheduler("retention", { pattern: "43 2 * * *" }, { name: "retention", data: { task: "retention" } });
  // Au démarrage : on s'assure que le watch est actif et on rattrape les messages manqués.
  await m.add("renew-watch", { task: "renew-watch" });
  await m.add("catch-up", { task: "catch-up" });
}

await schedule();
logger.info({ queues: workers.map((w) => w.name) }, "worker démarré");

async function shutdown(signal: string) {
  logger.info({ signal }, "arrêt du worker…");
  await Promise.allSettled(workers.map((w) => w.close()));
  await ctx.queues.close();
  await connection.quit();
  await disconnectDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
