import { describe, expect, it } from "vitest";
import { quoteTotals, renderQuotePdf } from "./quote";
import { renderReturnPdf } from "./return";

const company = { legalName: "Ma Boutique SAS", address: "1 rue X\n75000 Paris", siret: "123 456 789 00012", vatNumber: "FR00123456789", email: "contact@b.fr", phone: "" };

describe("PDF", () => {
  it("calcule les totaux à partir de prix TTC", () => {
    expect(quoteTotals([{ title: "a", sku: null, quantity: 2, unitPriceTtc: 60 }], 0.2)).toEqual({ totalTtc: 120, totalHt: 100, totalVat: 20 });
  });

  it("génère un devis PDF valide (plusieurs pages si besoin)", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ title: `iPhone 13 128 Go – grade A n°${i}`, sku: `IP13-${i}`, quantity: 1, unitPriceTtc: 349.9 }));
    const pdf = await renderQuotePdf({
      number: "DEV-2026-00001",
      date: new Date("2026-10-25"),
      validUntil: new Date("2026-11-24"),
      company,
      customer: { name: "Service achats", email: "achats@entreprise.fr" },
      lines,
      vatRate: 0.2,
      terms: "Paiement à la commande.",
      paymentUrl: "https://boutique.myshopify.com/invoices/abc",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it("génère un bon de retour PDF", async () => {
    const pdf = await renderReturnPdf({
      rmaNumber: "RET-2026-00001",
      date: new Date("2026-10-25"),
      company,
      customer: { name: "Jeanne", email: "j@x.fr" },
      orderName: "#1081",
      items: [{ title: "iPhone 13", quantity: 1 }],
      deadline: new Date("2026-10-29"),
      returnAddress: "Service retours\n1 rue X\n75000 Paris",
      shippingCostText: "Frais à votre charge.",
      reason: "Ne convient pas",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
