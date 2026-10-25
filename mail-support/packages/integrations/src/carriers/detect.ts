import type { CarrierCode } from "./types";

/** Déduit le transporteur à partir du nom saisi dans Shopify ou du format du numéro. */
export function detectCarrier(company: string | null | undefined, trackingNumber?: string | null): CarrierCode {
  const c = (company ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (c.includes("colissimo")) return "colissimo";
  if (c.includes("chronopost")) return "chronopost";
  if (c.includes("laposte") || c.includes("lettresuivie")) return "laposte";
  if (c.includes("mondialrelay")) return "mondialrelay";
  if (c.includes("dpd")) return "dpd";
  if (c.includes("gls")) return "gls";
  if (c.includes("ups")) return "ups";
  if (c.includes("dhl")) return "dhl";
  if (c.includes("fedex")) return "fedex";
  if (c.includes("colisprive")) return "colisprive";
  const n = (trackingNumber ?? "").toUpperCase();
  if (/^\d[A-Z]\d{11}$/.test(n) || /^[A-Z]{2}\d{9}FR$/.test(n)) return "colissimo";
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(n) && n.startsWith("X")) return "chronopost";
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return "ups";
  return "other";
}

/** URL publique de suivi quand Shopify n'en fournit pas. */
export function publicTrackingUrl(carrier: CarrierCode, n: string): string | null {
  const e = encodeURIComponent(n);
  switch (carrier) {
    case "colissimo":
    case "laposte":
      return `https://www.laposte.fr/outils/suivre-vos-envois?code=${e}`;
    case "chronopost":
      return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${e}`;
    case "dpd":
      return `https://trace.dpd.fr/fr/trace/${e}`;
    case "gls":
      return `https://gls-group.com/FR/fr/suivi-colis?match=${e}`;
    case "ups":
      return `https://www.ups.com/track?loc=fr_FR&tracknum=${e}`;
    case "dhl":
      return `https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=${e}`;
    default:
      return null;
  }
}

/** Domaines des transporteurs, autorisés dans les liens des réponses. */
export const CARRIER_DOMAINS = [
  "laposte.fr",
  "colissimo.fr",
  "chronopost.fr",
  "mondialrelay.fr",
  "dpd.fr",
  "dpd.com",
  "gls-group.com",
  "gls-group.eu",
  "ups.com",
  "dhl.com",
  "dhl.fr",
  "fedex.com",
  "colisprive.com",
  "17track.net",
];
