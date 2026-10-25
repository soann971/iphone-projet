import type { TrackingStatus } from "./types";

/** Statut d'expédition Shopify (FulfillmentDisplayStatus) → statut normalisé. */
export function fromShopifyDisplayStatus(s: string | null | undefined): TrackingStatus {
  switch (s) {
    case "DELIVERED":
      return "DELIVERED";
    case "OUT_FOR_DELIVERY":
      return "OUT_FOR_DELIVERY";
    case "IN_TRANSIT":
    case "CARRIER_PICKED_UP":
    case "DELAYED":
      return "IN_TRANSIT";
    case "READY_FOR_PICKUP":
    case "PICKED_UP":
      return s === "PICKED_UP" ? "DELIVERED" : "AVAILABLE_FOR_PICKUP";
    case "ATTEMPTED_DELIVERY":
    case "FAILURE":
    case "NOT_DELIVERED":
      return "EXCEPTION";
    case "CONFIRMED":
    case "LABEL_PRINTED":
    case "LABEL_PURCHASED":
    case "FULFILLED":
    case "MARKED_AS_FULFILLED":
    case "SUBMITTED":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}
