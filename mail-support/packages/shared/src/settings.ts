import { z } from "zod";

/**
 * Paramètres métier modifiables à chaud depuis le dashboard.
 * Stockés dans la table Setting (une ligne par clé). Les valeurs par défaut sont prudentes :
 * l'envoi automatique est DÉSACTIVÉ tant que vous ne l'activez pas (mode rodage).
 */
export const SettingsSchema = z.object({
  /** Interrupteur général de l'envoi automatique. */
  autoSendEnabled: z.boolean().default(false),
  /** Catégories autorisées à l'envoi automatique. */
  autoSendCategories: z
    .array(z.enum(["INFO", "ORDER", "QUOTE", "WARRANTY", "RETURN", "AFTER_SALES", "SHIPPING"]))
    .default(["INFO", "ORDER", "SHIPPING", "RETURN", "WARRANTY", "QUOTE", "AFTER_SALES"]),
  /** Seuil de confiance IA (0–1) au-dessus duquel l'envoi automatique est permis. */
  confidenceThreshold: z.number().min(0).max(1).default(0.85),
  /** Montant TTC (€) au-delà duquel une validation humaine est obligatoire. */
  amountReviewThreshold: z.number().min(0).default(150),
  /** Nombre max de réponses automatiques par fil sur 24 h (anti-boucle). */
  maxAutoRepliesPerThreadPerDay: z.number().int().min(0).default(2),
  /** Mettre en validation le premier mail d'un expéditeur inconnu de Shopify. */
  reviewUnknownSenders: z.boolean().default(false),

  /** Signature ajoutée à chaque réponse. */
  signature: z.string().default("L'équipe service client\nMa Boutique"),
  /** Nom de l'entreprise utilisé dans les réponses. */
  shopName: z.string().default("Ma Boutique"),
  /** Lien public de la boutique (seul domaine autorisé par défaut dans les réponses). */
  shopUrl: z.string().default("https://example.com"),
  /** Domaines autorisés pour les liens dans les réponses (en plus de shopUrl et des transporteurs). */
  allowedLinkDomains: z.array(z.string()).default([]),

  /** Durée de garantie par défaut (mois) si le produit Shopify n'a pas de métachamp custom.warranty_months. */
  defaultWarrantyMonths: z.number().int().min(0).default(24),
  /** Délai de rétractation (jours, à compter de la livraison). */
  returnWindowDays: z.number().int().min(0).default(14),
  /** Adresse de retour imprimée sur la procédure. */
  returnAddress: z.string().default("Ma Boutique – Service retours\n1 rue de l'Exemple\n75000 Paris"),
  /** Qui paie les frais de retour (texte affiché au client). */
  returnShippingCostText: z
    .string()
    .default("Les frais de retour sont à votre charge, sauf produit défectueux ou erreur de notre part."),

  /** Validité des devis (jours). */
  quoteValidityDays: z.number().int().min(1).default(30),
  /** Taux de TVA appliqué aux devis (prix Shopify TTC). */
  vatRate: z.number().min(0).max(1).default(0.2),
  /** Créer une commande provisoire Shopify (lien de paiement) pour chaque devis. */
  shopifyCreateDraftOrders: z.boolean().default(true),
  /** Créer la demande de retour dans Shopify quand un retour est validé. */
  shopifyCreateReturns: z.boolean().default(true),

  /** Informations légales imprimées sur les PDF. */
  company: z
    .object({
      legalName: z.string().default("Ma Boutique SAS"),
      address: z.string().default("1 rue de l'Exemple\n75000 Paris"),
      siret: z.string().default(""),
      vatNumber: z.string().default(""),
      email: z.string().default(""),
      phone: z.string().default(""),
      quoteTerms: z
        .string()
        .default("Devis valable jusqu'à la date indiquée. Prix TTC en euros. Paiement à la commande."),
    })
    .default({
      legalName: "Ma Boutique SAS",
      address: "1 rue de l'Exemple\n75000 Paris",
      siret: "",
      vatNumber: "",
      email: "",
      phone: "",
      quoteTerms: "Devis valable jusqu'à la date indiquée. Prix TTC en euros. Paiement à la commande.",
    }),

  /** Conservation des données (mois après le dernier contact). 0 = illimité. */
  retentionMonths: z.number().int().min(0).default(36),
  /** Conservation du journal d'audit (mois). */
  auditRetentionMonths: z.number().int().min(1).default(60),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});
