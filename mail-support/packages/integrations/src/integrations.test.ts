import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { ShopifyClient, mapOrder, matchVariant, verifyShopifyWebhook, type RawOrder, type ShopVariant } from "./shopify";
import { LaPosteTracker, detectCarrier, mapLaPosteCode, resolveShipment, type CarrierTracker } from "./carriers";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const rawOrder: RawOrder = {
  id: "gid://shopify/Order/1",
  name: "#1052",
  email: "Client.C@Exemple.fr",
  createdAt: "2026-10-01T10:00:00Z",
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "FULFILLED",
  currentTotalPriceSet: { shopMoney: { amount: "349.90", currencyCode: "EUR" } },
  lineItems: {
    nodes: [
      { id: "gid://shopify/LineItem/10", title: "iPhone 13 128 Go", sku: "IP13-128", quantity: 1, variant: { id: "v1" }, product: { id: "p1", warranty: { value: "12" } } },
      { id: "gid://shopify/LineItem/11", title: "Coque", sku: null, quantity: 2, variant: null, product: { id: "p2", warranty: null } },
    ],
  },
  fulfillments: [
    {
      id: "gid://shopify/Fulfillment/5",
      createdAt: "2026-10-02T10:00:00Z",
      deliveredAt: null,
      displayStatus: "IN_TRANSIT",
      trackingInfo: [{ company: "Colissimo", number: "6A12345678901", url: null }],
      fulfillmentLineItems: { nodes: [{ id: "fli1", quantity: 1, lineItem: { id: "gid://shopify/LineItem/10" } }] },
    },
  ],
};

describe("Shopify", () => {
  it("normalise une commande", () => {
    const o = mapOrder(rawOrder);
    expect(o.email).toBe("client.c@exemple.fr");
    expect(o.totalPrice).toBe(349.9);
    expect(o.lineItems[0]).toMatchObject({ warrantyMonths: 12, fulfillmentLineItems: [{ id: "fli1", quantity: 1 }] });
    expect(o.lineItems[1]!.warrantyMonths).toBeNull();
    expect(o.fulfillments[0]!.tracking[0]!.number).toBe("6A12345678901");
  });

  it("obtient un jeton (client credentials), le met en cache et interroge GraphQL", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/admin/oauth/access_token")) {
        expect(String(init?.body)).toContain("grant_type=client_credentials");
        return json(200, { access_token: "tok_1", scope: "read_orders", expires_in: 86399 });
      }
      expect((init?.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("tok_1");
      expect(url).toBe("https://boutique.myshopify.com/admin/api/2026-10/graphql.json");
      return json(200, { data: { orders: { nodes: [rawOrder] } } });
    });
    const client = new ShopifyClient(
      { storeDomain: "boutique.myshopify.com", clientId: "id", clientSecret: "secret", apiVersion: "2026-10" },
      undefined,
      fetchMock as never,
    );
    expect((await client.orderByName("#1052"))?.name).toBe("#1052");
    expect(await client.orderByName("#9999")).toBeNull();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("access_token"))).toHaveLength(1);
  });

  it("refuse les noms de commande non numériques (pas d'injection dans la recherche)", async () => {
    const client = new ShopifyClient({ storeDomain: "b.myshopify.com", clientId: "", clientSecret: "", adminToken: "x", apiVersion: "2026-10" }, undefined, vi.fn() as never);
    expect(await client.orderByName('#1 OR email:"*"')).toBeNull();
  });

  it("vérifie la signature HMAC des webhooks", () => {
    const body = JSON.stringify({ id: 1 });
    const sig = createHmac("sha256", "secret").update(body).digest("base64");
    expect(verifyShopifyWebhook(body, sig, "secret")).toBe(true);
    expect(verifyShopifyWebhook(body, sig, "autre")).toBe(false);
    expect(verifyShopifyWebhook(body, undefined, "secret")).toBe(false);
  });

  it("associe un produit demandé à une seule variante, sinon rien", () => {
    const v = (id: string, productTitle: string, title: string): ShopVariant => ({
      variantId: id,
      productTitle,
      title,
      displayName: `${productTitle} - ${title}`,
      sku: null,
      price: 300,
      availableForSale: true,
      inventoryQuantity: 5,
    });
    const catalog = [v("a", "iPhone 13", "128 Go / Grade A"), v("b", "iPhone 13", "256 Go / Grade A"), v("c", "iPhone 13 Pro", "128 Go / Grade A")];
    expect(matchVariant("iPhone 13 128 Go grade A", catalog)?.variantId).toBe("a");
    expect(matchVariant("iPhone 13 128GB", catalog)?.variantId).toBe("a"); // "13 Pro" écarté
    expect(matchVariant("iPhone 13 Pro", catalog)?.variantId).toBe("c");
    expect(matchVariant("iPhone 13", catalog)).toBeNull(); // ambigu
    expect(matchVariant("Samsung S24", catalog)).toBeNull();
  });
});

describe("transporteurs", () => {
  it("détecte le transporteur", () => {
    expect(detectCarrier("Colissimo", null)).toBe("colissimo");
    expect(detectCarrier("Mondial Relay", null)).toBe("mondialrelay");
    expect(detectCarrier(null, "6A12345678901")).toBe("colissimo");
    expect(detectCarrier(null, "1Z999AA10123456784")).toBe("ups");
  });

  it("traduit les codes La Poste", () => {
    expect(mapLaPosteCode("DI1")).toBe("DELIVERED");
    expect(mapLaPosteCode("MD2")).toBe("OUT_FOR_DELIVERY");
    expect(mapLaPosteCode("AG1")).toBe("AVAILABLE_FOR_PICKUP");
    expect(mapLaPosteCode("ET1")).toBe("IN_TRANSIT");
    expect(mapLaPosteCode("ND1")).toBe("EXCEPTION");
  });

  it("interroge La Poste quand Shopify ne confirme pas la livraison", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, {
        shipment: {
          idShip: "6A12345678901",
          event: [
            { code: "PC1", label: "Pris en charge", date: "2026-10-02T08:00:00+02:00" },
            { code: "DI1", label: "Votre colis est livré", date: "2026-10-04T11:00:00+02:00" },
          ],
        },
      }),
    );
    const r = await resolveShipment(
      { company: "Colissimo", trackingNumber: "6A12345678901", trackingUrl: null, shopifyDisplayStatus: "IN_TRANSIT", shopifyDeliveredAt: null },
      [new LaPosteTracker("key", fetchMock as never)],
    );
    expect(r).toMatchObject({ status: "DELIVERED", source: "laposte", label: "Votre colis est livré" });
    expect(r.deliveredAt?.toISOString()).toBe("2026-10-04T09:00:00.000Z");
    expect(r.trackingUrl).toBe("https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901");
  });

  it("se rabat sur Shopify si le transporteur est indisponible", async () => {
    const failing: CarrierTracker = { name: "x", supports: () => true, track: async () => Promise.reject(new Error("down")) };
    const r = await resolveShipment(
      { company: "DPD", trackingNumber: "123", trackingUrl: "https://trace.dpd.fr/fr/trace/123", shopifyDisplayStatus: "IN_TRANSIT", shopifyDeliveredAt: null },
      [failing],
    );
    expect(r).toMatchObject({ status: "IN_TRANSIT", source: "shopify" });
  });

  it("ne contacte pas le transporteur si Shopify confirme la livraison", async () => {
    const tracker = { name: "x", supports: () => true, track: vi.fn() };
    const r = await resolveShipment(
      { company: "Colissimo", trackingNumber: "6A1", trackingUrl: null, shopifyDisplayStatus: "DELIVERED", shopifyDeliveredAt: new Date("2026-10-04") },
      [tracker],
    );
    expect(r.status).toBe("DELIVERED");
    expect(tracker.track).not.toHaveBeenCalled();
  });
});
