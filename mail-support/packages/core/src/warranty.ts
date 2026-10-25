import { addMonths, endOfDayUtc } from "./dates";

export interface WarrantyInput {
  /** Date d'achat (commande Shopify). */
  purchaseDate: Date | null;
  /** Date de livraison si connue : la garantie légale court à partir de la délivrance du bien. */
  deliveredAt?: Date | null;
  warrantyMonths: number;
  now?: Date;
}

export interface WarrantyResult {
  /** true = couvert, false = expiré, null = impossible à déterminer (donnée manquante). */
  eligible: boolean | null;
  startDate: Date | null;
  expiresAt: Date | null;
  /** Raison lisible (stockée et montrée à l'opérateur). */
  reason: string;
}

/**
 * Calcule la couverture de garantie. Logique déterministe : l'IA ne décide jamais de l'éligibilité.
 * Point de départ : date de livraison si connue, sinon date d'achat (plus défavorable au client
 * d'au plus quelques jours : un refus calculé ainsi est toujours revu par un humain).
 */
export function computeWarranty({ purchaseDate, deliveredAt, warrantyMonths, now = new Date() }: WarrantyInput): WarrantyResult {
  const start = deliveredAt ?? purchaseDate;
  if (!start) {
    return { eligible: null, startDate: null, expiresAt: null, reason: "Date d'achat inconnue : commande non identifiée" };
  }
  if (warrantyMonths <= 0) {
    return { eligible: false, startDate: start, expiresAt: start, reason: "Produit sans garantie" };
  }
  const expiresAt = endOfDayUtc(addMonths(start, warrantyMonths));
  const basis = deliveredAt ? "livraison" : "achat";
  if (now.getTime() <= expiresAt.getTime()) {
    return { eligible: true, startDate: start, expiresAt, reason: `Sous garantie (${warrantyMonths} mois à compter de la ${basis})` };
  }
  return { eligible: false, startDate: start, expiresAt, reason: `Garantie expirée (${warrantyMonths} mois à compter de la ${basis})` };
}
