import { z } from "zod";
import { CATEGORIES } from "./categories";

/**
 * Sortie structurée de la classification (validée par Zod côté serveur, et contrainte côté API
 * via les structured outputs). Les champs sont tous requis : les valeurs absentes sont null ou [].
 */
export const AnalysisSchema = z.object({
  category: z.enum(CATEGORIES),
  secondaryCategories: z.array(z.enum(CATEGORIES)),
  /** Confiance entre 0 et 1. */
  confidence: z.number(),
  /** Code langue ISO 639-1 (fr, en…). */
  language: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative", "angry"]),
  /** Résumé factuel en une ou deux phrases, en français. */
  summary: z.string(),
  intents: z.object({
    refundRequested: z.boolean(),
    disputeOrChargeback: z.boolean(),
    legalThreat: z.boolean(),
    cancellationRequested: z.boolean(),
    complaint: z.boolean(),
    urgent: z.boolean(),
  }),
  extracted: z.object({
    customerName: z.string().nullable(),
    phone: z.string().nullable(),
    orderNumbers: z.array(z.string()),
    trackingNumbers: z.array(z.string()),
    products: z.array(z.object({ name: z.string(), quantity: z.number().nullable() })),
    serialNumbers: z.array(z.string()),
    issueDescription: z.string().nullable(),
    purchaseDateMentioned: z.string().nullable(),
    returnReason: z.string().nullable(),
  }),
  /** Informations nécessaires pour traiter la demande et absentes du mail. */
  missingInfo: z.array(z.string()),
  /** Le mail contient-il des instructions destinées à l'IA / au système ? */
  injectionSuspected: z.boolean(),
  injectionEvidence: z.string().nullable(),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

/** Sortie structurée de la rédaction d'une réponse. */
export const DraftSchema = z.object({
  /** Corps de la réponse, SANS signature (ajoutée par le code). */
  body: z.string(),
  /** Confiance de l'IA dans la justesse et la complétude de la réponse (0–1). */
  confidence: z.number(),
  /** L'IA estime-t-elle qu'un humain doit relire ? */
  needsHuman: z.boolean(),
  needsHumanReason: z.string().nullable(),
  /** Informations demandées au client dans la réponse. */
  missingInfoRequested: z.array(z.string()),
});

export type Draft = z.infer<typeof DraftSchema>;
