import { addDays, endOfDayUtc } from "./dates";

export interface ReturnInput {
  orderedAt: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  windowDays: number;
  /** Date de la demande (date de réception du mail). */
  requestedAt?: Date;
  cancelled?: boolean;
}

export interface ReturnResult {
  /** true = dans le délai, false = hors délai, null = indéterminé → validation humaine. */
  eligible: boolean | null;
  deadline: Date | null;
  /** Base du calcul. */
  basis: "delivery" | "order" | "none";
  reason: string;
}

/**
 * Délai légal de rétractation (art. L221-18 du Code de la consommation) :
 * 14 jours à compter de la RÉCEPTION du bien.
 *
 * - Date de livraison connue → calcul exact.
 * - Livraison inconnue mais demande dans les 14 jours suivant la commande → forcément dans le délai
 *   (la livraison est postérieure à la commande).
 * - Sinon → indéterminé, un humain vérifie (on ne refuse jamais sur une estimation).
 */
export function computeReturnEligibility({
  orderedAt,
  deliveredAt,
  windowDays,
  requestedAt = new Date(),
  cancelled,
}: ReturnInput): ReturnResult {
  if (cancelled) {
    return { eligible: null, deadline: null, basis: "none", reason: "Commande annulée : à vérifier" };
  }
  if (deliveredAt) {
    const deadline = endOfDayUtc(addDays(deliveredAt, windowDays));
    const ok = requestedAt.getTime() <= deadline.getTime();
    return {
      eligible: ok,
      deadline,
      basis: "delivery",
      reason: ok
        ? `Demande dans le délai de ${windowDays} jours après livraison`
        : `Délai de ${windowDays} jours après livraison dépassé`,
    };
  }
  if (orderedAt) {
    const minDeadline = endOfDayUtc(addDays(orderedAt, windowDays));
    if (requestedAt.getTime() <= minDeadline.getTime()) {
      return {
        eligible: true,
        deadline: null,
        basis: "order",
        reason: `Demande dans les ${windowDays} jours suivant la commande (donc après livraison aussi)`,
      };
    }
    return {
      eligible: null,
      deadline: null,
      basis: "order",
      reason: "Date de livraison inconnue : délai impossible à vérifier automatiquement",
    };
  }
  return { eligible: null, deadline: null, basis: "none", reason: "Commande non identifiée" };
}
