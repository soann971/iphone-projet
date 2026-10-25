import { describe, expect, it } from "vitest";
import { computeWarranty } from "./warranty";
import { computeReturnEligibility } from "./returns";
import { addMonths } from "./dates";

const d = (s: string) => new Date(`${s}T10:00:00Z`);

describe("computeWarranty", () => {
  it("couvre un produit dans la période", () => {
    const r = computeWarranty({ purchaseDate: d("2025-06-01"), warrantyMonths: 24, now: d("2026-10-25") });
    expect(r.eligible).toBe(true);
    expect(r.expiresAt?.toISOString().slice(0, 10)).toBe("2027-06-01");
  });

  it("refuse après expiration", () => {
    const r = computeWarranty({ purchaseDate: d("2024-01-10"), warrantyMonths: 24, now: d("2026-02-01") });
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/expirée/);
  });

  it("part de la livraison si elle est connue (plus favorable)", () => {
    const r = computeWarranty({ purchaseDate: d("2024-10-20"), deliveredAt: d("2024-10-28"), warrantyMonths: 24, now: d("2026-10-25") });
    expect(r.eligible).toBe(true);
  });

  it("est indéterminée sans date d'achat", () => {
    expect(computeWarranty({ purchaseDate: null, warrantyMonths: 24 }).eligible).toBeNull();
  });

  it("couvre jusqu'à la fin du dernier jour", () => {
    const r = computeWarranty({ purchaseDate: d("2025-10-25"), warrantyMonths: 12, now: new Date("2026-10-25T22:00:00Z") });
    expect(r.eligible).toBe(true);
  });

  it("gère les fins de mois", () => {
    expect(addMonths(d("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(d("2024-01-31"), 1).toISOString().slice(0, 10)).toBe("2024-02-29");
  });
});

describe("computeReturnEligibility", () => {
  it("accepte dans les 14 jours après livraison", () => {
    const r = computeReturnEligibility({ orderedAt: d("2026-10-01"), deliveredAt: d("2026-10-15"), windowDays: 14, requestedAt: d("2026-10-25") });
    expect(r.eligible).toBe(true);
    expect(r.basis).toBe("delivery");
    expect(r.deadline?.toISOString().slice(0, 10)).toBe("2026-10-29");
  });

  it("refuse au-delà de 14 jours après livraison", () => {
    const r = computeReturnEligibility({ orderedAt: d("2026-09-01"), deliveredAt: d("2026-09-03"), windowDays: 14, requestedAt: d("2026-10-25") });
    expect(r.eligible).toBe(false);
  });

  it("accepte sans date de livraison si la commande a moins de 14 jours", () => {
    const r = computeReturnEligibility({ orderedAt: d("2026-10-20"), windowDays: 14, requestedAt: d("2026-10-25") });
    expect(r.eligible).toBe(true);
    expect(r.basis).toBe("order");
  });

  it("ne refuse jamais sur une estimation : indéterminé sans livraison connue", () => {
    const r = computeReturnEligibility({ orderedAt: d("2026-08-01"), windowDays: 14, requestedAt: d("2026-10-25") });
    expect(r.eligible).toBeNull();
  });

  it("indéterminé sans commande", () => {
    expect(computeReturnEligibility({ orderedAt: null, windowDays: 14 }).eligible).toBeNull();
  });
});
