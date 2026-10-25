import type { Analysis, Category, Draft, Settings } from "@ms/shared";
import type { FactFlag } from "./facts";
import type { GuardIssue } from "./reply-guard";

export interface PolicyInput {
  settings: Pick<
    Settings,
    "autoSendEnabled" | "autoSendCategories" | "confidenceThreshold" | "amountReviewThreshold" | "maxAutoRepliesPerThreadPerDay" | "reviewUnknownSenders"
  >;
  analysis: Pick<Analysis, "category" | "confidence" | "sentiment" | "intents" | "injectionSuspected" | "language">;
  draft: Pick<Draft, "confidence" | "needsHuman" | "needsHumanReason"> | null;
  flags: FactFlag[];
  guardIssues: GuardIssue[];
  amountInvolved: number | null;
  isAutomatedSender: boolean;
  autoRepliesLast24h: number;
  customerKnownInShopify: boolean;
}

export interface PolicyDecision {
  decision: "AUTO" | "REVIEW" | "NO_REPLY";
  /** Raisons lisibles (affichées dans le dashboard). Vide si AUTO. */
  reasons: string[];
  /** Confiance retenue (min classification / rédaction). */
  confidence: number;
}

const FLAG_REASONS: Partial<Record<FactFlag, string>> = {
  IDENTITY_MISMATCH: "L'expéditeur n'est pas le titulaire de la commande citée",
  WARRANTY_REFUSED: "Garantie refusée (expirée ou non applicable)",
  WARRANTY_UNDETERMINED: "Garantie impossible à vérifier automatiquement",
  RETURN_OUT_OF_WINDOW: "Retour hors délai de rétractation",
  RETURN_UNDETERMINED: "Délai de retour impossible à vérifier automatiquement",
  QUOTE_INCOMPLETE: "Devis incomplet : produit introuvable ou ambigu dans le catalogue",
  SHOPIFY_UNAVAILABLE: "Shopify indisponible : données de commande non vérifiées",
  ORDER_CANCELLED: "Commande annulée",
};

/**
 * Moteur de décision : envoi automatique ou validation humaine.
 * Règle d'or : au moindre doute, validation humaine. Chaque règle ajoute une raison.
 */
export function decide(input: PolicyInput): PolicyDecision {
  const { settings, analysis, draft } = input;
  const confidence = clamp01(Math.min(analysis.confidence, draft?.confidence ?? 0));

  if (analysis.category === "SPAM") {
    return analysis.confidence >= settings.confidenceThreshold
      ? { decision: "NO_REPLY", reasons: [], confidence: analysis.confidence }
      : { decision: "REVIEW", reasons: ["Spam probable, à confirmer"], confidence: analysis.confidence };
  }

  const reasons: string[] = [];
  const add = (r: string) => reasons.includes(r) || reasons.push(r);

  if (input.isAutomatedSender) {
    // Jamais de réponse à un répondeur automatique : risque de boucle.
    return { decision: "NO_REPLY", reasons: ["Message automatique (répondeur, rebond, liste)"], confidence };
  }

  // Toujours en validation humaine (règles métier imposées).
  if (analysis.intents.refundRequested) add("Demande de remboursement");
  if (analysis.intents.disputeOrChargeback) add("Litige / contestation de paiement");
  if (analysis.intents.legalThreat) add("Menace de recours juridique");
  if (analysis.sentiment === "angry" || analysis.sentiment === "negative") add("Client mécontent");
  if (analysis.intents.complaint) add("Réclamation");
  if (analysis.injectionSuspected) add("Tentative de manipulation de l'IA détectée dans le mail");
  if (input.amountInvolved !== null && input.amountInvolved > settings.amountReviewThreshold)
    add(`Montant supérieur au seuil (${settings.amountReviewThreshold} €)`);
  for (const f of input.flags) {
    const r = FLAG_REASONS[f];
    if (r) add(r);
  }

  // Qualité de la réponse.
  if (!draft) add("Aucune réponse générée");
  else {
    if (draft.needsHuman) add(`L'IA demande une relecture${draft.needsHumanReason ? ` : ${draft.needsHumanReason}` : ""}`);
    if (confidence < settings.confidenceThreshold)
      add(`Confiance ${(confidence * 100).toFixed(0)} % < seuil ${(settings.confidenceThreshold * 100).toFixed(0)} %`);
  }
  if (input.guardIssues.length > 0)
    add(`Donnée non vérifiée dans la réponse : ${input.guardIssues.map((i) => i.value).slice(0, 3).join(", ")}`);
  if (analysis.language !== "fr") add(`Langue du client : ${analysis.language}`);

  // Garde-fous de configuration.
  if (!settings.autoSendEnabled) add("Envoi automatique désactivé (mode validation)");
  if (!settings.autoSendCategories.includes(analysis.category as Exclude<Category, "SPAM">))
    add("Catégorie non autorisée à l'envoi automatique");
  if (input.autoRepliesLast24h >= settings.maxAutoRepliesPerThreadPerDay) add("Trop de réponses automatiques sur ce fil (24 h)");
  if (settings.reviewUnknownSenders && !input.customerKnownInShopify) add("Expéditeur inconnu de Shopify");

  return { decision: reasons.length ? "REVIEW" : "AUTO", reasons, confidence };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
