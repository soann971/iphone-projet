import { httpJson, type FetchLike } from "../http";
import type { CarrierCode, CarrierTracker, TrackingResult, TrackingStatus } from "./types";

const MAP: Record<string, TrackingStatus> = {
  NotFound: "UNKNOWN",
  InfoReceived: "PENDING",
  InTransit: "IN_TRANSIT",
  Expired: "EXCEPTION",
  AvailableForPickup: "AVAILABLE_FOR_PICKUP",
  OutForDelivery: "OUT_FOR_DELIVERY",
  DeliveryFailure: "EXCEPTION",
  Delivered: "DELIVERED",
  Exception: "EXCEPTION",
};

interface TrackInfo {
  latest_status?: { status?: string };
  latest_event?: { time_iso?: string; description?: string; location?: string } | null;
  tracking?: { providers?: { events?: { time_iso?: string; description?: string; location?: string }[] }[] };
}

/** Agrégateur 17TRACK (Mondial Relay, DPD, GLS, UPS, DHL…). Le numéro est enregistré au premier appel. */
export class SeventeenTrackTracker implements CarrierTracker {
  readonly name = "17track";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  supports(_c: CarrierCode) {
    return !!this.apiKey;
  }

  private post<T>(path: string, body: unknown) {
    return httpJson<T>(this.fetchImpl, `https://api.17track.net/track/v2.2/${path}`, {
      method: "POST",
      headers: { "17token": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async track(trackingNumber: string): Promise<TrackingResult | null> {
    const get = () => this.post<{ data?: { accepted?: { number: string; track_info?: TrackInfo }[] } }>("gettrackinfo", [{ number: trackingNumber }]);
    let { data } = await get();
    let info = data?.data?.accepted?.[0]?.track_info;
    if (!info) {
      await this.post("register", [{ number: trackingNumber }]);
      ({ data } = await get());
      info = data?.data?.accepted?.[0]?.track_info;
    }
    if (!info) return null;
    const status = MAP[info.latest_status?.status ?? ""] ?? "UNKNOWN";
    const events = (info.tracking?.providers?.[0]?.events ?? [])
      .filter((e) => e.time_iso)
      .map((e) => ({ date: new Date(e.time_iso!), label: e.description ?? "", location: e.location ?? null }));
    const last = info.latest_event?.time_iso
      ? { date: new Date(info.latest_event.time_iso), label: info.latest_event.description ?? "", location: info.latest_event.location ?? null }
      : (events[0] ?? null);
    return {
      status,
      label: last?.label ?? "",
      deliveredAt: status === "DELIVERED" && last ? last.date : null,
      lastEvent: last,
      events,
      source: "17track",
    };
  }
}
