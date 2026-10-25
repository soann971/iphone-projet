/** Normalise une adresse email pour l'identification client. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Extrait l'adresse d'un en-tête "Nom <adresse@x.fr>". */
export function parseAddress(header: string): { email: string; name: string | null } {
  const m = header.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: normalizeEmail(m[2]!), name: m[1]!.trim() || null };
  return { email: normalizeEmail(header.replace(/[<>]/g, "")), name: null };
}

export function parseAddressList(header: string | undefined | null): string[] {
  if (!header) return [];
  return header
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((p) => parseAddress(p).email)
    .filter((e) => e.includes("@"));
}

const QUOTE_HEADERS = [
  /^\s*Le .{3,200}a écrit\s*:?\s*$/im,
  /^\s*On .{3,200}wrote\s*:?\s*$/im,
  /^\s*-{2,}\s*(Original Message|Message d'origine|Message original)\s*-{2,}/im,
  /^\s*(De|From)\s*:.*\n\s*(Envoyé|Sent|Date)\s*:/im,
  /^\s*_{10,}\s*$/m,
];

const SIGNATURE_MARKERS = [/^-- ?$/m, /^(Envoyé|Sent) (de|depuis|from) mon (iPhone|Android|mobile|iPad)/im, /^Get Outlook for/im];

/**
 * Nettoie le corps d'un mail : retire les citations de messages précédents, la signature
 * et les espaces superflus. Le résultat est ce que voit l'IA (le fil complet reste en base).
 */
export function cleanEmailBody(text: string, maxLength = 8000): string {
  let t = text.replace(/\r\n/g, "\n");
  let cut = t.length;
  for (const re of [...QUOTE_HEADERS, ...SIGNATURE_MARKERS]) {
    const m = re.exec(t);
    if (m && m.index > 0 && m.index < cut) cut = m.index;
  }
  t = t.slice(0, cut);
  t = t
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length > maxLength) t = `${t.slice(0, maxLength)}\n[… message tronqué]`;
  return t;
}

/** Conversion HTML → texte minimaliste (pour les mails sans partie text/plain). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/** Numéros de commande Shopify cités (#1234, commande 1234, n° 1234). Complète l'extraction IA. */
export function extractOrderRefs(text: string): string[] {
  const refs = new Set<string>();
  const patterns = [/#\s?(\d{3,8})\b/g, /\bcommande\s*(?:n°|no|num(?:éro)?|numero)?\s*:?\s*#?(\d{3,8})\b/gi, /\bn°\s*(\d{3,8})\b/gi];
  for (const re of patterns) for (const m of text.matchAll(re)) refs.add(`#${m[1]}`);
  return [...refs];
}

export interface HeaderMap {
  [name: string]: string | undefined;
}

/**
 * Détecte les mails automatiques (répondeurs, rebonds, newsletters) auxquels on ne doit
 * JAMAIS répondre automatiquement (risque de boucle infinie).
 */
export function isAutomatedEmail(headers: HeaderMap, fromEmail: string): { automated: boolean; reason?: string } {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), (v ?? "").toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return { automated: true, reason: "Auto-Submitted" };
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"]?.includes("all"))
    return { automated: true, reason: "réponse automatique" };
  if (["bulk", "list", "junk", "auto_reply"].includes(h["precedence"] ?? "")) return { automated: true, reason: `Precedence: ${h["precedence"]}` };
  if (h["list-id"] || h["list-unsubscribe"]) return { automated: true, reason: "liste de diffusion" };
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/i.test(fromEmail))
    return { automated: true, reason: "expéditeur système" };
  if (h["content-type"]?.includes("multipart/report")) return { automated: true, reason: "rapport de non-remise" };
  return { automated: false };
}

/** Sujet de réponse : "Re: <sujet>" sans empiler les préfixes. */
export function replySubject(subject: string): string {
  const s = subject.trim() || "Votre demande";
  return /^(re|réf|ref|tr|fw|fwd)\s*:/i.test(s) ? s.replace(/^(réf|ref)\s*:/i, "Re:") : `Re: ${s}`;
}
