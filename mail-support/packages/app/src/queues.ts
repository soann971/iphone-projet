import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const QUEUE = {
  SYNC: "gmail-sync",
  INGEST: "ingest",
  PROCESS: "process",
  SEND: "send",
  SHOPIFY: "shopify",
  MAINTENANCE: "maintenance",
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface SyncJob {
  accountId: string;
  /** historyId annoncé par la notification (informatif). */
  historyId?: string;
}
export interface IngestJob {
  accountId: string;
  gmailMessageId: string;
}
export interface ProcessJob {
  messageId: string;
  /** Consigne d'un opérateur (régénération depuis le dashboard). */
  operatorNote?: string;
  /** Refaire l'analyse IA même si elle existe déjà. */
  force?: boolean;
}
export interface SendJob {
  draftId: string;
}
export interface ShopifyJob {
  topic: string;
  /** Identifiant GraphQL de la ressource (admin_graphql_api_id). */
  resourceId?: string;
  orderId?: string;
  customerEmail?: string;
}
export interface MaintenanceJob {
  task: "renew-watch" | "catch-up" | "retention" | "rotate-secrets";
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 6,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

/** Accès typé aux files d'attente (utilisé par l'API et le worker pour planifier des jobs). */
export class Queues {
  readonly sync: Queue<SyncJob>;
  readonly ingest: Queue<IngestJob>;
  readonly process: Queue<ProcessJob>;
  readonly send: Queue<SendJob>;
  readonly shopify: Queue<ShopifyJob>;
  readonly maintenance: Queue<MaintenanceJob>;

  constructor(readonly connection: Redis) {
    const opts = { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS };
    this.sync = new Queue(QUEUE.SYNC, opts);
    this.ingest = new Queue(QUEUE.INGEST, opts);
    this.process = new Queue(QUEUE.PROCESS, opts);
    this.send = new Queue(QUEUE.SEND, { ...opts, defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 4 } });
    this.shopify = new Queue(QUEUE.SHOPIFY, opts);
    this.maintenance = new Queue(QUEUE.MAINTENANCE, { ...opts, defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 2 } });
  }

  all() {
    return [this.sync, this.ingest, this.process, this.send, this.shopify, this.maintenance];
  }

  /** Synchronisation d'une boîte : dédupliquée (une seule en attente à la fois par boîte). */
  enqueueSync(accountId: string, historyId?: string) {
    return this.sync.add("sync", { accountId, historyId }, { deduplication: { id: `sync:${accountId}`, ttl: 5_000 } });
  }

  /** Un job par message Gmail (jobId = id Gmail : jamais traité deux fois en parallèle). */
  enqueueIngest(accountId: string, gmailMessageId: string) {
    return this.ingest.add("ingest", { accountId, gmailMessageId }, { jobId: `ingest-${gmailMessageId}` });
  }

  /** `force` : régénération demandée (nouvel identifiant de job, l'analyse est refaite). */
  enqueueProcess(messageId: string, opts: { operatorNote?: string; force?: boolean } = {}) {
    const forced = opts.force || !!opts.operatorNote;
    const jobId = forced ? `process-${messageId}-${Date.now()}` : `process-${messageId}`;
    return this.process.add("process", { messageId, operatorNote: opts.operatorNote, force: forced }, { jobId });
  }

  enqueueSend(draftId: string) {
    return this.send.add("send", { draftId }, { jobId: `send-${draftId}` });
  }

  async close() {
    await Promise.all(this.all().map((q) => q.close()));
  }
}
