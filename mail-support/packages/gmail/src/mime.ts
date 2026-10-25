import { cleanEmailBody, htmlToText, parseAddress, parseAddressList } from "@ms/core";

/** Sous-ensemble du type gmail_v1.Schema$MessagePart utilisé ici (facilite les tests). */
export interface GmailPart {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
}

export interface GmailRawMessage {
  id?: string | null;
  threadId?: string | null;
  labelIds?: string[] | null;
  snippet?: string | null;
  internalDate?: string | null;
  payload?: GmailPart | null;
}

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string | null;
}

export interface ParsedMessage {
  gmailMessageId: string;
  threadId: string;
  labelIds: string[];
  headers: Record<string, string>;
  rfcMessageId: string | null;
  references: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  /** Texte complet (text/plain, ou HTML converti). */
  bodyFull: string;
  /** Texte nettoyé (sans citations/signature). */
  bodyText: string;
  snippet: string;
  receivedAt: Date;
  attachments: ParsedAttachment[];
}

const decodeB64Url = (data: string) => Buffer.from(data, "base64url").toString("utf8");

function walk(part: GmailPart, visit: (p: GmailPart) => void) {
  visit(part);
  for (const p of part.parts ?? []) walk(p, visit);
}

export function parseGmailMessage(msg: GmailRawMessage): ParsedMessage {
  if (!msg.id || !msg.threadId || !msg.payload) throw new Error("Message Gmail incomplet");
  const headers: Record<string, string> = {};
  for (const h of msg.payload.headers ?? []) {
    if (h.name) headers[h.name.toLowerCase()] = h.value ?? "";
  }

  let plain = "";
  let html = "";
  const attachments: ParsedAttachment[] = [];
  walk(msg.payload, (p) => {
    const mime = (p.mimeType ?? "").toLowerCase();
    if (p.filename) {
      attachments.push({
        filename: p.filename,
        mimeType: mime || "application/octet-stream",
        size: p.body?.size ?? 0,
        attachmentId: p.body?.attachmentId ?? null,
      });
      return;
    }
    if (!p.body?.data) return;
    if (mime === "text/plain" && !plain) plain = decodeB64Url(p.body.data);
    else if (mime === "text/html" && !html) html = decodeB64Url(p.body.data);
  });

  const bodyFull = (plain || htmlToText(html)).trim();
  const from = parseAddress(headers["from"] ?? "");
  const date = msg.internalDate ? new Date(Number(msg.internalDate)) : headers["date"] ? new Date(headers["date"]) : new Date();

  return {
    gmailMessageId: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    headers,
    rfcMessageId: headers["message-id"] ?? null,
    references: headers["references"] ?? null,
    fromEmail: from.email,
    fromName: from.name,
    toEmails: parseAddressList(headers["to"]),
    ccEmails: parseAddressList(headers["cc"]),
    subject: headers["subject"] ?? "",
    bodyFull,
    bodyText: cleanEmailBody(bodyFull),
    snippet: msg.snippet ?? "",
    receivedAt: Number.isNaN(date.getTime()) ? new Date() : date,
    attachments,
  };
}

/** Encode un en-tête non ASCII (RFC 2047). */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface OutgoingMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string | null;
  attachments?: OutgoingAttachment[];
  /** En-têtes supplémentaires (ex. X-MS-Draft-Id pour l'idempotence). */
  extraHeaders?: Record<string, string>;
  /** Marque la réponse comme automatique (RFC 3834) : évite que d'autres robots y répondent. */
  autoReplied?: boolean;
}

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

/** Construit le message MIME (RFC 5322) à envoyer via users.messages.send (champ raw, base64url). */
export function buildMime(m: OutgoingMessage, boundary = `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`): string {
  const headers: string[] = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    "MIME-Version: 1.0",
  ];
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  const refs = [m.references, m.inReplyTo].filter(Boolean).join(" ").trim();
  if (refs) headers.push(`References: ${refs}`);
  if (m.autoReplied) headers.push("Auto-Submitted: auto-replied");
  for (const [k, v] of Object.entries(m.extraHeaders ?? {})) headers.push(`${k}: ${v}`);

  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(m.text.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64")),
  ].join("\r\n");

  if (!m.attachments?.length) {
    return [...headers, textPart].join("\r\n");
  }

  const parts = [textPart];
  for (const a of m.attachments) {
    parts.push(
      [
        `Content-Type: ${a.mimeType}; name="${encodeHeader(a.filename)}"`,
        `Content-Disposition: attachment; filename="${encodeHeader(a.filename)}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap76(a.content.toString("base64")),
      ].join("\r\n"),
    );
  }
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((p) => `--${boundary}\r\n${p}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export const toRaw = (mime: string) => Buffer.from(mime, "utf8").toString("base64url");
