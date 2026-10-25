/**
 * Garde-fou après rédaction : toute donnée « sensible » présente dans la réponse
 * (montant, date, numéro de suivi, lien, téléphone, email) doit provenir des faits vérifiés.
 * Sinon, la réponse part en validation humaine. C'est la défense principale contre
 * les hallucinations et contre les injections qui tenteraient de faire écrire un lien ou un prix.
 */

export interface GuardInput {
  body: string;
  /** Toutes les valeurs autorisées (montants, dates formatées, numéros, URLs…), issues des faits. */
  allowedLiterals: string[];
  /** Domaines autorisés pour les liens. */
  allowedDomains: string[];
  /** Emails autorisés (adresse du support, du client). */
  allowedEmails?: string[];
}

export interface GuardIssue {
  kind: "amount" | "date" | "link" | "email" | "phone" | "reference";
  value: string;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s  ]/g, "")
    .replace(/,/g, ".");

const amountRe = /\d{1,3}(?:[   .]\d{3})*(?:[.,]\d{1,2})?\s?(?:€|eur\b|euros?\b)|€\s?\d+(?:[.,]\d{1,2})?/gi;
const dateRe =
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}(?:er)?\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+\d{4})?\b/gi;
const urlRe = /\bhttps?:\/\/[^\s<>()"']+|\bwww\.[^\s<>()"']+/gi;
const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const phoneRe = /(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}\b/g;
/** Suites alphanumériques longues (numéros de suivi, références). */
const refRe = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,30}\b/g;

function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function domainAllowed(host: string, allowed: string[]): boolean {
  return allowed.some((d) => {
    const dd = d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return host === dd || host.endsWith(`.${dd}`);
  });
}

export function checkReply({ body, allowedLiterals, allowedDomains, allowedEmails = [] }: GuardInput): GuardIssue[] {
  const allowed = new Set(allowedLiterals.map(normalize));
  const allowedBlob = allowedLiterals.map(normalize).join(" | ");
  const isAllowed = (v: string) => allowed.has(normalize(v)) || allowedBlob.includes(normalize(v));
  const issues: GuardIssue[] = [];

  for (const m of body.matchAll(amountRe)) {
    const v = m[0].trim();
    const numeric = v.replace(/[^\d.,]/g, "");
    if (!isAllowed(v) && !isAllowed(numeric)) issues.push({ kind: "amount", value: v });
  }
  for (const m of body.matchAll(dateRe)) {
    if (!isAllowed(m[0])) issues.push({ kind: "date", value: m[0] });
  }
  const urls = [...body.matchAll(urlRe)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));
  for (const url of urls) {
    const host = hostOf(url);
    if (!host || (!domainAllowed(host, allowedDomains) && !isAllowed(url))) issues.push({ kind: "link", value: url });
  }
  const bodyWithoutUrls = urls.reduce((b, u) => b.split(u).join(" "), body);
  const okEmails = new Set(allowedEmails.map((e) => e.toLowerCase()));
  for (const m of bodyWithoutUrls.matchAll(emailRe)) {
    if (!okEmails.has(m[0].toLowerCase()) && !isAllowed(m[0])) issues.push({ kind: "email", value: m[0] });
  }
  for (const m of bodyWithoutUrls.matchAll(phoneRe)) {
    if (!isAllowed(m[0])) issues.push({ kind: "phone", value: m[0] });
  }
  for (const m of bodyWithoutUrls.matchAll(refRe)) {
    if (!isAllowed(m[0])) issues.push({ kind: "reference", value: m[0] });
  }
  return issues;
}
