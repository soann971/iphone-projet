import { logger } from "@ms/shared";
import { detectCarrier, publicTrackingUrl } from "./detect";
import { fromShopifyDisplayStatus } from "./shopify-status";
import { STATUS_LABELS_FR, type CarrierTracker, type TrackingResult } from "./types";

export interface ShipmentInput {
  company: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shopifyDisplayStatus: string | null;
  shopifyDeliveredAt: Date | null;
}

export interface ResolvedShipment extends TrackingResult {
  carrier: string | null;
  trackingUrl: string | null;
}

/**
 * Statut d'un colis : Shopify d'abord (s'il confirme la livraison), puis l'API du transporteur,
 * sinon le statut Shopify. Jamais de statut inventé : à défaut, UNKNOWN.
 */
export async function resolveShipment(input: ShipmentInput, trackers: CarrierTracker[]): Promise<ResolvedShipment> {
  const carrier = detectCarrier(input.company, input.trackingNumber);
  const trackingUrl = input.trackingUrl ?? (input.trackingNumber ? publicTrackingUrl(carrier, input.trackingNumber) : null);
  const shopifyStatus = fromShopifyDisplayStatus(input.shopifyDisplayStatus);
  const base = { carrier: input.company ?? (carrier === "other" ? null : carrier), trackingUrl };

  const fromShopify: ResolvedShipment = {
    ...base,
    status: input.shopifyDeliveredAt ? "DELIVERED" : shopifyStatus,
    label: STATUS_LABELS_FR[input.shopifyDeliveredAt ? "DELIVERED" : shopifyStatus],
    deliveredAt: input.shopifyDeliveredAt,
    lastEvent: null,
    events: [],
    source: "shopify",
  };
  if (fromShopify.status === "DELIVERED" || !input.trackingNumber) return fromShopify;

  for (const t of trackers) {
    if (!t.supports(carrier)) continue;
    try {
      const r = await t.track(input.trackingNumber, carrier);
      if (r && r.status !== "UNKNOWN") return { ...base, ...r, label: r.label || STATUS_LABELS_FR[r.status] };
    } catch (err) {
      logger.warn({ err: (err as Error).message, tracker: t.name }, "suivi transporteur indisponible");
    }
  }
  return fromShopify;
}
