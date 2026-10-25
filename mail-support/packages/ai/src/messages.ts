import type { Analysis } from "@ms/shared";
import type { VerifiedFacts } from "@ms/core";
import { wrapEmail } from "./sanitize";
import type { ThreadMessage } from "./prompts";

export interface ClassifyInput {
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
  attachments: string[];
  /** Messages précédents du fil (du plus ancien au plus récent), déjà nettoyés. */
  thread: ThreadMessage[];
}

const MAX_THREAD = 4;
const MAX_THREAD_CHARS = 1500;

function renderThread(thread: ThreadMessage[]): string {
  return thread
    .slice(-MAX_THREAD)
    .map((m) => `[${m.direction === "INBOUND" ? "Client" : "Boutique"} — ${m.date}]\n${m.text.slice(0, MAX_THREAD_CHARS)}`)
    .join("\n\n");
}

export function buildClassifyContent(i: ClassifyInput): string {
  const parts = [
    `<metadonnees>\nExpéditeur : ${i.from}\nDate : ${i.receivedAt}\nPièces jointes : ${i.attachments.length ? i.attachments.join(", ") : "aucune"}\n</metadonnees>`,
  ];
  if (i.thread.length) parts.push(wrapEmail("fil_precedent", renderThread(i.thread)));
  parts.push(wrapEmail("email_client", `Objet : ${i.subject}\n\n${i.body}`));
  parts.push("Analyse le dernier mail du client en tenant compte du fil.");
  return parts.join("\n\n");
}

export interface DraftInput {
  analysis: Pick<Analysis, "category" | "summary" | "sentiment" | "intents" | "missingInfo">;
  facts: VerifiedFacts;
  subject: string;
  body: string;
  thread: ThreadMessage[];
  /** Consigne facultative d'un opérateur (régénération depuis le dashboard). */
  operatorNote?: string;
}

export function buildDraftContent(i: DraftInput): string {
  // Les flags internes ne sont pas utiles à la rédaction et ne doivent pas fuiter.
  const { flags: _flags, amountInvolved: _amount, ...publicFacts } = i.facts;
  const parts = [
    `<faits_verifies>\n${JSON.stringify(publicFacts, null, 2)}\n</faits_verifies>`,
    `<analyse>\nCatégorie : ${i.analysis.category}\nRésumé : ${i.analysis.summary}\nSentiment : ${i.analysis.sentiment}\nDemande de remboursement : ${i.analysis.intents.refundRequested ? "oui" : "non"}\n</analyse>`,
  ];
  if (i.thread.length) parts.push(wrapEmail("fil_precedent", renderThread(i.thread)));
  parts.push(wrapEmail("email_client", `Objet : ${i.subject}\n\n${i.body}`));
  if (i.operatorNote) {
    // La consigne opérateur vient d'un utilisateur authentifié du dashboard (pas du client).
    parts.push(`<consigne_operateur>\n${i.operatorNote}\n</consigne_operateur>`);
  }
  parts.push("Rédige la réponse au dernier mail du client.");
  return parts.join("\n\n");
}
