/**
 * Doublures de test du contexte applicatif : base PostgreSQL réelle (TEST_DATABASE_URL),
 * Gmail / Claude / Shopify / files d'attente simulés.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiProvider } from "@ms/ai";
import { getDb } from "@ms/db";
import type { GmailService, ParsedMessage } from "@ms/gmail";
import type { ShopifyClient, ShopOrder, ShopVariant } from "@ms/integrations";
import { DEFAULT_SETTINGS, loadEnv, type Analysis, type Draft, type Settings } from "@ms/shared";
import type { AppContext } from "./context";
import type { Queues } from "./queues";
import { FileStorage } from "./storage";
import { ALL_LABELS } from "./labels";

export const SUPPORT_EMAIL = "support@boutique.test";

export class FakeGmail {
  messages = new Map<string, ParsedMessage>();
  sent: { threadId: string; msg: Parameters<GmailService["send"]>[1]; id: string }[] = [];
  modified: { threadId: string; add: string[]; remove: string[] }[] = [];
  headerHits = new Map<string, string>();

  async getMessage(id: string) {
    return this.messages.get(id) ?? null;
  }
  async send(threadId: string, msg: Parameters<GmailService["send"]>[1]) {
    const id = `sent-${this.sent.length + 1}`;
    this.sent.push({ threadId, msg, id });
    return { id, threadId };
  }
  async threadHasHeader(_threadId: string, _h: string, value: string) {
    return this.headerHits.get(value) ?? null;
  }
  async modifyThread(threadId: string, add: string[], remove: string[] = []) {
    this.modified.push({ threadId, add, remove });
  }
  async listHistory() {
    return { messageIds: [...this.messages.keys()], newHistoryId: "999", expired: false };
  }
  async listMessageIds() {
    return [...this.messages.keys()];
  }
  async getProfile() {
    return { email: SUPPORT_EMAIL, historyId: "1" };
  }
}

export interface FakeShopifyData {
  orders: ShopOrder[];
  variants: ShopVariant[];
}

export function fakeShopify(data: FakeShopifyData) {
  const calls = { draftOrders: [] as unknown[], returns: [] as unknown[] };
  const client = {
    domain: "boutique.myshopify.com",
    calls,
    async findCustomerByEmail(email: string) {
      const n = data.orders.filter((o) => o.email === email).length;
      return n ? { id: `gid://shopify/Customer/${email}`, displayName: "Client", firstName: null, email, numberOfOrders: n } : null;
    },
    async ordersByEmail(email: string) {
      return data.orders.filter((o) => o.email === email);
    },
    async orderByName(name: string) {
      return data.orders.find((o) => o.name === name) ?? null;
    },
    async orderById(id: string) {
      return data.orders.find((o) => o.shopifyId === id) ?? null;
    },
    async searchVariants(text: string) {
      const t = text.toLowerCase();
      return data.variants.filter((v) => t.split(" ").some((w) => w.length > 2 && v.displayName.toLowerCase().includes(w)));
    },
    async createDraftOrder(input: unknown) {
      calls.draftOrders.push(input);
      return { id: "gid://shopify/DraftOrder/1", name: "#D1", invoiceUrl: "https://boutique.myshopify.com/1/invoices/abc" };
    },
    async createReturnRequest(input: unknown) {
      calls.returns.push(input);
      return { id: "gid://shopify/Return/1", name: "#R1", status: "REQUESTED" };
    },
  };
  return client as unknown as ShopifyClient & { calls: typeof calls };
}

export function fakeQueues() {
  const jobs = { ingest: [] as string[], process: [] as string[], send: [] as string[], sync: [] as string[], shopify: [] as unknown[] };
  const q = {
    jobs,
    send: { name: "send", add: async (_n: string, d: { draftId: string }) => void jobs.send.push(d.draftId) },
    shopify: { name: "shopify", add: async (_n: string, d: unknown) => void jobs.shopify.push(d) },
    all: () => [],
    enqueueIngest: async (_a: string, id: string) => void jobs.ingest.push(id),
    enqueueProcess: async (id: string) => void jobs.process.push(id),
    enqueueSend: async (id: string) => void jobs.send.push(id),
    enqueueSync: async (id: string) => void jobs.sync.push(id),
  };
  return q as unknown as Queues & { jobs: typeof jobs };
}

export interface FakeAiScript {
  classify: (subject: string, body: string) => Analysis;
  draft: (facts: Parameters<AiProvider["draft"]>[0]) => Draft;
}

export function fakeAi(script: FakeAiScript): AiProvider & { drafts: Parameters<AiProvider["draft"]>[0][] } {
  const drafts: Parameters<AiProvider["draft"]>[0][] = [];
  const usage = { model: "fake", promptVersion: "test", inputTokens: 10, outputTokens: 5, latencyMs: 1 };
  return {
    drafts,
    async classify(i) {
      return { output: script.classify(i.subject, i.body), usage };
    },
    async draft(i) {
      drafts.push(i);
      return { output: script.draft(i), usage };
    },
  };
}

export async function createTestContext(opts: { ai: AiProvider; shopify: ShopifyClient | null; settings?: Partial<Settings>; now?: Date }) {
  const url = process.env.TEST_DATABASE_URL!;
  process.env.DATABASE_URL = url;
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  process.env.SESSION_SECRET ??= "x".repeat(40);
  const env = loadEnv({ ...process.env, DATABASE_URL: url });
  const db = getDb(url);
  const gmail = new FakeGmail();
  const queues = fakeQueues();
  const labelIds = Object.fromEntries(ALL_LABELS.map((l, i) => [l, `Label_${i}`]));
  const account = await db.gmailAccount.create({ data: { email: SUPPORT_EMAIL, encryptedRefreshToken: "x", scopes: "gmail.modify", labelIds, historyId: "1" } });
  const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const ctx: AppContext = {
    env,
    db,
    queues,
    ai: opts.ai,
    shopify: opts.shopify,
    trackers: [],
    storage: new FileStorage(mkdtempSync(join(tmpdir(), "ms-storage-"))),
    google: { clientId: "", clientSecret: "", redirectUri: "" },
    settings: async () => settings,
    gmail: async () => ({ service: gmail as unknown as GmailService, email: SUPPORT_EMAIL, labelIds }),
    now: () => opts.now ?? new Date(),
  };
  return { ctx, gmail, queues, account, labelIds };
}

export async function resetDb() {
  const db = getDb(process.env.TEST_DATABASE_URL!);
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let seq = 0;
export function inbound(over: Partial<ParsedMessage> & { subject: string; bodyText: string; fromEmail: string }): ParsedMessage {
  seq++;
  return {
    gmailMessageId: `g${seq}`,
    threadId: `t${seq}`,
    labelIds: ["INBOX"],
    headers: {},
    rfcMessageId: `<m${seq}@mail.test>`,
    references: null,
    fromName: null,
    toEmails: [SUPPORT_EMAIL],
    ccEmails: [],
    bodyFull: over.bodyText,
    snippet: "",
    receivedAt: new Date(),
    attachments: [],
    ...over,
  };
}
