import { httpJson, type FetchLike } from "../http";
import type { CarrierCode, CarrierTracker, TrackingEvent, TrackingResult, TrackingStatus } from "./types";

interface LaPosteResponse {
  returnCode?: number;
  shipment?: {
    idShip: string;
    isFinal?: boolean;
    deliveryDate?: string;
    event?: { code: string; label: string; date: string }[];
  };
}

/** Codes événement La Poste → statut normalisé. */
export function mapLaPosteCode(code: string): TrackingStatus {
  if (code === "DI1" || code === "DI0") return "DELIVERED";
  if (code === "DI2" || code.startsWith("RE")) return "RETURNED";
  if (code === "MD2") return "OUT_FOR_DELIVERY";
  if (code === "AG1") return "AVAILABLE_FOR_PICKUP";
  if (code.startsWith("ND") || code.startsWith("AN")) return "EXCEPTION";
  if (code === "DR1") return "PENDING";
  if (/^(PC|ET|EP|DO|PB|MD)/.test(code)) return "IN_TRANSIT";
  return "UNKNOWN";
}

/** API Suivi v2 de La Poste (Colissimo, Chronopost, courrier suivi). Clé gratuite sur developer.laposte.fr. */
export class LaPosteTracker implements CarrierTracker {
  readonly name = "laposte";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  supports(c: CarrierCode) {
    return !!this.apiKey && (c === "colissimo" || c === "chronopost" || c === "laposte");
  }

  async track(trackingNumber: string): Promise<TrackingResult | null> {
    const { status, data } = await httpJson<LaPosteResponse>(
      this.fetchImpl,
      `https://api.laposte.fr/suivi/v2/idships/${encodeURIComponent(trackingNumber)}?lang=fr_FR`,
      { headers: { "X-Okapi-Key": this.apiKey, Accept: "application/json" } },
    );
    if (status === 404 || status === 400 || !data?.shipment) return null;
    const events: TrackingEvent[] = (data.shipment.event ?? [])
      .map((e) => ({ date: new Date(e.date), label: e.label, code: e.code }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());
    const latest = (data.shipment.event ?? []).slice().sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
    const st = latest ? mapLaPosteCode(latest.code) : "UNKNOWN";
    return {
      status: st,
      label: latest?.label ?? "",
      deliveredAt: st === "DELIVERED" ? new Date(data.shipment.deliveryDate ?? latest!.date) : null,
      lastEvent: events[0] ? { date: events[0].date, label: events[0].label } : null,
      events: events.map(({ date, label }) => ({ date, label })),
      source: "laposte",
    };
  }
}
