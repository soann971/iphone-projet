export const TRACKING_STATUSES = [
  "PENDING",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "AVAILABLE_FOR_PICKUP",
  "DELIVERED",
  "EXCEPTION",
  "RETURNED",
  "UNKNOWN",
] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export const STATUS_LABELS_FR: Record<TrackingStatus, string> = {
  PENDING: "En préparation / pris en charge prochainement",
  IN_TRANSIT: "En cours d'acheminement",
  OUT_FOR_DELIVERY: "En cours de livraison",
  AVAILABLE_FOR_PICKUP: "Disponible en point de retrait",
  DELIVERED: "Livré",
  EXCEPTION: "Incident de livraison",
  RETURNED: "Retourné à l'expéditeur",
  UNKNOWN: "Statut indisponible",
};

export interface TrackingEvent {
  date: Date;
  label: string;
  location?: string | null;
}

export interface TrackingResult {
  status: TrackingStatus;
  /** Libellé du transporteur (dernier événement), sinon libellé normalisé. */
  label: string;
  deliveredAt: Date | null;
  lastEvent: TrackingEvent | null;
  events: TrackingEvent[];
  source: "shopify" | "laposte" | "17track";
}

export interface CarrierTracker {
  readonly name: string;
  supports(carrier: CarrierCode): boolean;
  track(trackingNumber: string, carrier: CarrierCode): Promise<TrackingResult | null>;
}

export type CarrierCode = "colissimo" | "chronopost" | "laposte" | "mondialrelay" | "dpd" | "gls" | "ups" | "dhl" | "fedex" | "colisprive" | "other";
