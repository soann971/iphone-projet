/** Catégories de mails gérées. Les valeurs sont stables : elles sont stockées en base et servent de noms de libellés Gmail. */
export const CATEGORIES = [
  "INFO",
  "ORDER",
  "QUOTE",
  "WARRANTY",
  "RETURN",
  "AFTER_SALES",
  "SHIPPING",
  "SPAM",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  INFO: "Information",
  ORDER: "Commande",
  QUOTE: "Devis",
  WARRANTY: "Garantie",
  RETURN: "Retour",
  AFTER_SALES: "SAV",
  SHIPPING: "Livraison",
  SPAM: "Spam",
};

/** Libellé Gmail appliqué au fil, ex. "Support/Garantie". */
export const gmailLabelName = (c: Category) => `Support/${CATEGORY_LABELS[c]}`;
