import { gmail, type gmail_v1 } from "@googleapis/gmail";
import { PermanentError, TransientError } from "@ms/shared";
import { createOAuthClient, type GoogleOAuthConfig } from "./oauth";
import { buildMime, parseGmailMessage, toRaw, type OutgoingMessage, type ParsedMessage } from "./mime";

export interface HistoryResult {
  /** Messages ajoutés depuis le curseur (ids Gmail). */
  messageIds: string[];
  newHistoryId: string | null;
  /** Curseur trop ancien (> ~7 jours) : une resynchronisation complète est nécessaire. */
  expired: boolean;
}

/** Client Gmail pour UNE boîte connectée. */
export class GmailService {
  readonly api: gmail_v1.Gmail;

  constructor(cfg: GoogleOAuthConfig, refreshToken: string) {
    const auth = createOAuthClient(cfg);
    auth.setCredentials({ refresh_token: refreshToken });
    this.api = gmail({ version: "v1", auth });
  }

  async getProfile() {
    const { data } = await this.call(() => this.api.users.getProfile({ userId: "me" }));
    return { email: data.emailAddress ?? "", historyId: data.historyId ?? null };
  }

  /** Abonne la boîte aux notifications Pub/Sub (à renouveler au moins tous les 7 jours). */
  async watch(topicName: string) {
    const { data } = await this.call(() =>
      this.api.users.watch({ userId: "me", requestBody: { topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" } }),
    );
    return { historyId: data.historyId ?? null, expiration: data.expiration ? new Date(Number(data.expiration)) : null };
  }

  async stop() {
    await this.call(() => this.api.users.stop({ userId: "me" }));
  }

  async listHistory(startHistoryId: string): Promise<HistoryResult> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let newHistoryId: string | null = null;
    try {
      do {
        const { data } = await this.call(() =>
          this.api.users.history.list({ userId: "me", startHistoryId, historyTypes: ["messageAdded"], pageToken, maxResults: 500 }),
        );
        for (const h of data.history ?? []) for (const m of h.messagesAdded ?? []) if (m.message?.id) ids.add(m.message.id);
        newHistoryId = data.historyId ?? newHistoryId;
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch (err) {
      if (statusOf(err) === 404) return { messageIds: [], newHistoryId: null, expired: true };
      throw err;
    }
    return { messageIds: [...ids], newHistoryId, expired: false };
  }

  /** Liste les messages correspondant à une requête Gmail (resynchronisation, rattrapage). */
  async listMessageIds(q: string, max = 200): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const { data } = await this.call(() => this.api.users.messages.list({ userId: "me", q, pageToken, maxResults: Math.min(100, max) }));
      for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  /** Récupère et analyse un message. Retourne null s'il a été supprimé entre-temps. */
  async getMessage(id: string): Promise<ParsedMessage | null> {
    try {
      const { data } = await this.call(() => this.api.users.messages.get({ userId: "me", id, format: "full" }));
      return parseGmailMessage(data);
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const { data } = await this.call(() => this.api.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId }));
    return Buffer.from(data.data ?? "", "base64url");
  }

  /** Envoie une réponse dans le fil existant. */
  async send(threadId: string, msg: OutgoingMessage): Promise<{ id: string; threadId: string }> {
    const { data } = await this.call(() =>
      this.api.users.messages.send({ userId: "me", requestBody: { threadId, raw: toRaw(buildMime(msg)) } }),
    );
    if (!data.id) throw new TransientError("Envoi Gmail sans identifiant de message");
    return { id: data.id, threadId: data.threadId ?? threadId };
  }

  /** Cherche dans le fil un message portant un en-tête donné (idempotence de l'envoi). */
  async threadHasHeader(threadId: string, header: string, value: string): Promise<string | null> {
    const { data } = await this.call(() =>
      this.api.users.threads.get({ userId: "me", id: threadId, format: "metadata", metadataHeaders: [header] }),
    );
    for (const m of data.messages ?? []) {
      const h = m.payload?.headers?.find((x) => x.name?.toLowerCase() === header.toLowerCase());
      if (h?.value === value) return m.id ?? null;
    }
    return null;
  }

  /** Crée les libellés manquants et retourne la correspondance nom → id. */
  async ensureLabels(names: string[]): Promise<Record<string, string>> {
    const { data } = await this.call(() => this.api.users.labels.list({ userId: "me" }));
    const map: Record<string, string> = {};
    for (const l of data.labels ?? []) if (l.name && l.id) map[l.name] = l.id;
    for (const name of names) {
      if (map[name]) continue;
      const { data: created } = await this.call(() =>
        this.api.users.labels.create({
          userId: "me",
          requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
        }),
      );
      if (created.id) map[name] = created.id;
    }
    return map;
  }

  async modifyThread(threadId: string, addLabelIds: string[], removeLabelIds: string[] = []) {
    if (!addLabelIds.length && !removeLabelIds.length) return;
    await this.call(() => this.api.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds, removeLabelIds } }));
  }

  /** Traduit les erreurs Google en erreurs passagères (réessayées) ou définitives. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const status = statusOf(err);
      if (status === 404) throw err; // géré par l'appelant
      if (status === 401 || status === 403) {
        const msg = (err as Error).message ?? "";
        if (/rate|quota|limit/i.test(msg)) throw new TransientError(`Quota Gmail : ${msg}`);
        throw new PermanentError(`Accès Gmail refusé (reconnectez la boîte) : ${msg}`);
      }
      if (status === 400 && /invalid_grant/i.test(String((err as Error).message))) {
        throw new PermanentError("Autorisation Gmail révoquée ou expirée : reconnectez la boîte depuis le dashboard");
      }
      if (status === 429 || (status !== undefined && status >= 500) || status === undefined) {
        throw new TransientError(`Erreur Gmail temporaire : ${(err as Error).message}`);
      }
      throw err;
    }
  }
}

function statusOf(err: unknown): number | undefined {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: number } };
  const s = e?.response?.status ?? e?.status ?? e?.code;
  return typeof s === "number" ? s : typeof s === "string" && /^\d+$/.test(s) ? Number(s) : undefined;
}
