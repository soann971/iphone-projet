import { PermanentError, TransientError } from "@ms/shared";
import { httpJson, type FetchLike } from "../http";
import {
  CUSTOMER_QUERY,
  DRAFT_ORDER_CREATE,
  ORDER_QUERY,
  ORDERS_QUERY,
  RETURN_REQUEST,
  SHOP_QUERY,
  VARIANTS_QUERY,
  WEBHOOK_CREATE,
  WEBHOOKS_LIST,
} from "./queries";
import type { ShopCustomer, ShopOrder, ShopVariant } from "./types";

export interface ShopifyConfig {
  /** ex. ma-boutique.myshopify.com */
  storeDomain: string;
  clientId: string;
  clientSecret: string;
  /** Jeton d'une ancienne app personnalisée (shpat_…), prioritaire s'il est fourni. */
  adminToken?: string;
  apiVersion: string;
}

/** Stockage du jeton (chiffré en base dans le worker/API). */
export interface TokenStore {
  get(): Promise<{ token: string; expiresAt: Date } | null>;
  set(token: string, expiresAt: Date): Promise<void>;
}

export const isShopifyConfigured = (c: ShopifyConfig) => !!c.storeDomain && (!!c.adminToken || (!!c.clientId && !!c.clientSecret));

export class ShopifyClient {
  private memo: { token: string; expiresAt: Date } | null = null;

  constructor(
    private readonly cfg: ShopifyConfig,
    private readonly store?: TokenStore,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get domain() {
    return this.cfg.storeDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  /**
   * Jeton d'accès Admin API.
   * Apps du Dev Dashboard : "client credentials grant" (jeton valable 24 h, renouvelé 5 min avant expiration).
   */
  async accessToken(): Promise<string> {
    if (this.cfg.adminToken) return this.cfg.adminToken;
    const margin = 5 * 60_000;
    if (this.memo && this.memo.expiresAt.getTime() - margin > Date.now()) return this.memo.token;
    const stored = await this.store?.get();
    if (stored && stored.expiresAt.getTime() - margin > Date.now()) {
      this.memo = stored;
      return stored.token;
    }
    const { status, data } = await httpJson<{ access_token?: string; expires_in?: number; error_description?: string }>(
      this.fetchImpl,
      `https://${this.domain}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
      },
    );
    if (status !== 200 || !data?.access_token) {
      throw new PermanentError(`Shopify : obtention du jeton impossible (${status}) ${data?.error_description ?? ""}`.trim());
    }
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 86_399) * 1000);
    this.memo = { token: data.access_token, expiresAt };
    await this.store?.set(data.access_token, expiresAt);
    return data.access_token;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const doRequest = async () =>
      httpJson<{ data?: T; errors?: { message: string; extensions?: { code?: string } }[] }>(
        this.fetchImpl,
        `https://${this.domain}/admin/api/${this.cfg.apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await this.accessToken() },
          body: JSON.stringify({ query, variables }),
        },
      );
    let res;
    try {
      res = await doRequest();
    } catch (err) {
      // Jeton expiré/révoqué : on en redemande un une fois.
      if (err instanceof PermanentError && !this.cfg.adminToken && this.memo) {
        this.memo = null;
        await this.store?.set("", new Date(0));
        res = await doRequest();
      } else throw err;
    }
    const errors = res.data?.errors;
    if (errors?.length) {
      if (errors.some((e) => e.extensions?.code === "THROTTLED")) throw new TransientError("Shopify : limite de requêtes atteinte");
      throw new PermanentError(`Shopify GraphQL : ${errors.map((e) => e.message).join(" ; ")}`);
    }
    if (!res.data?.data) throw new TransientError("Shopify : réponse vide");
    return res.data.data;
  }

  async shopInfo() {
    const d = await this.graphql<{ shop: { name: string; myshopifyDomain: string; currencyCode: string } }>(SHOP_QUERY);
    return d.shop;
  }

  async findCustomerByEmail(email: string): Promise<ShopCustomer | null> {
    const d = await this.graphql<{ customers: { nodes: RawCustomer[] } }>(CUSTOMER_QUERY, { query: `email:${quote(email)}` });
    const c = d.customers.nodes[0];
    if (!c) return null;
    return {
      id: c.id,
      displayName: c.displayName ?? null,
      firstName: c.firstName ?? null,
      email: c.defaultEmailAddress?.emailAddress ?? null,
      numberOfOrders: Number(c.numberOfOrders ?? 0),
    };
  }

  async ordersByEmail(email: string, first = 10): Promise<ShopOrder[]> {
    const d = await this.graphql<{ orders: { nodes: RawOrder[] } }>(ORDERS_QUERY, { query: `email:${quote(email)}`, first });
    return d.orders.nodes.map(mapOrder);
  }

  /** Recherche une commande par son nom (#1234). */
  async orderByName(name: string): Promise<ShopOrder | null> {
    const clean = name.replace(/^#/, "").trim();
    if (!/^\d{1,10}$/.test(clean)) return null;
    const d = await this.graphql<{ orders: { nodes: RawOrder[] } }>(ORDERS_QUERY, { query: `name:${clean}`, first: 5 });
    return d.orders.nodes.map(mapOrder).find((o) => o.name.replace(/^#/, "") === clean) ?? null;
  }

  async orderById(id: string): Promise<ShopOrder | null> {
    const gid = id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
    const d = await this.graphql<{ order: RawOrder | null }>(ORDER_QUERY, { id: gid });
    return d.order ? mapOrder(d.order) : null;
  }

  async searchVariants(text: string): Promise<ShopVariant[]> {
    const words = text
      .replace(/["'():\\]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 6);
    if (!words.length) return [];
    const d = await this.graphql<{ productVariants: { nodes: RawVariant[] } }>(VARIANTS_QUERY, { query: words.join(" ") });
    return d.productVariants.nodes
      .filter((v) => v.product?.status === "ACTIVE")
      .map((v) => ({
        variantId: v.id,
        title: v.title,
        productTitle: v.product?.title ?? "",
        displayName: v.displayName,
        sku: v.sku ?? null,
        price: Number(v.price),
        availableForSale: Boolean(v.availableForSale),
        inventoryQuantity: v.inventoryQuantity ?? null,
      }));
  }

  /** Crée une commande provisoire : le client reçoit un lien de paiement Shopify (invoiceUrl). */
  async createDraftOrder(input: { email: string; lines: { variantId: string; quantity: number }[]; note: string; tags: string[] }) {
    const d = await this.graphql<{ draftOrderCreate: { draftOrder: { id: string; name: string; invoiceUrl: string | null } | null; userErrors: UserError[] } }>(
      DRAFT_ORDER_CREATE,
      { input: { email: input.email, note: input.note, tags: input.tags, lineItems: input.lines } },
    );
    assertNoUserErrors(d.draftOrderCreate.userErrors);
    if (!d.draftOrderCreate.draftOrder) throw new PermanentError("Shopify : commande provisoire non créée");
    return d.draftOrderCreate.draftOrder;
  }

  /** Crée une demande de retour (statut REQUESTED) visible dans l'admin Shopify. */
  async createReturnRequest(input: { orderId: string; lines: { fulfillmentLineItemId: string; quantity: number }[]; note: string }) {
    const d = await this.graphql<{ returnRequest: { return: { id: string; name: string; status: string } | null; userErrors: UserError[] } }>(
      RETURN_REQUEST,
      {
        input: {
          orderId: input.orderId,
          returnLineItems: input.lines.map((l) => ({ ...l, returnReason: "OTHER", customerNote: input.note.slice(0, 300) })),
        },
      },
    );
    assertNoUserErrors(d.returnRequest.userErrors);
    if (!d.returnRequest.return) throw new PermanentError("Shopify : retour non créé");
    return d.returnRequest.return;
  }

  /** Abonne l'application aux webhooks nécessaires (idempotent). */
  async ensureWebhooks(callbackUrl: string, topics: string[]) {
    const existing = await this.graphql<{ webhookSubscriptions: { nodes: { id: string; topic: string; uri: string }[] } }>(WEBHOOKS_LIST);
    const created: string[] = [];
    for (const topic of topics) {
      if (existing.webhookSubscriptions.nodes.some((w) => w.topic === topic && w.uri === callbackUrl)) continue;
      const d = await this.graphql<{ webhookSubscriptionCreate: { userErrors: UserError[] } }>(WEBHOOK_CREATE, {
        topic,
        sub: { uri: callbackUrl, format: "JSON" },
      });
      assertNoUserErrors(d.webhookSubscriptionCreate.userErrors);
      created.push(topic);
    }
    return created;
  }
}

export const SHOPIFY_WEBHOOK_TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED", "FULFILLMENTS_CREATE", "FULFILLMENTS_UPDATE"];

type UserError = { field?: string[] | null; message: string };
function assertNoUserErrors(errors: UserError[]) {
  if (errors?.length) throw new PermanentError(`Shopify : ${errors.map((e) => e.message).join(" ; ")}`);
}

const quote = (v: string) => `"${v.replace(/["\\]/g, "")}"`;

interface RawCustomer {
  id: string;
  displayName?: string | null;
  firstName?: string | null;
  defaultEmailAddress?: { emailAddress?: string | null } | null;
  numberOfOrders?: string | number | null;
}

interface RawVariant {
  id: string;
  title: string;
  displayName: string;
  sku?: string | null;
  price: string;
  availableForSale?: boolean;
  inventoryQuantity?: number | null;
  product?: { title: string; status: string } | null;
}

export interface RawOrder {
  id: string;
  name: string;
  email?: string | null;
  createdAt: string;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  customer?: { id: string } | null;
  currentTotalPriceSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
  lineItems?: {
    nodes: {
      id: string;
      title: string;
      sku?: string | null;
      quantity: number;
      variant?: { id: string } | null;
      product?: { id: string; warranty?: { value: string } | null } | null;
    }[];
  };
  fulfillments?: {
    id: string;
    createdAt: string;
    deliveredAt?: string | null;
    inTransitAt?: string | null;
    estimatedDeliveryAt?: string | null;
    displayStatus?: string | null;
    trackingInfo?: { company?: string | null; number?: string | null; url?: string | null }[];
    fulfillmentLineItems?: { nodes: { id: string; quantity: number; lineItem: { id: string } }[] };
  }[];
}

const date = (s?: string | null) => (s ? new Date(s) : null);

export function mapOrder(o: RawOrder): ShopOrder {
  const fulfillments = (o.fulfillments ?? []).map((f) => ({
    id: f.id,
    createdAt: new Date(f.createdAt),
    deliveredAt: date(f.deliveredAt),
    inTransitAt: date(f.inTransitAt),
    estimatedDeliveryAt: date(f.estimatedDeliveryAt),
    displayStatus: f.displayStatus ?? null,
    tracking: (f.trackingInfo ?? []).map((t) => ({ company: t.company ?? null, number: t.number ?? null, url: t.url ?? null })),
    lines: f.fulfillmentLineItems?.nodes ?? [],
  }));
  return {
    shopifyId: o.id,
    name: o.name,
    email: o.email?.toLowerCase() ?? null,
    customerId: o.customer?.id ?? null,
    createdAt: new Date(o.createdAt),
    cancelledAt: date(o.cancelledAt),
    currency: o.currentTotalPriceSet?.shopMoney.currencyCode ?? "EUR",
    totalPrice: Number(o.currentTotalPriceSet?.shopMoney.amount ?? 0),
    financialStatus: o.displayFinancialStatus ?? null,
    fulfillmentStatus: o.displayFulfillmentStatus ?? null,
    lineItems: (o.lineItems?.nodes ?? []).map((li) => {
      const w = li.product?.warranty?.value;
      return {
        id: li.id,
        title: li.title,
        sku: li.sku ?? null,
        quantity: li.quantity,
        variantId: li.variant?.id ?? null,
        productId: li.product?.id ?? null,
        warrantyMonths: w !== undefined && w !== null && /^\d+$/.test(w) ? Number(w) : null,
        fulfillmentLineItems: fulfillments.flatMap((f) => f.lines.filter((l) => l.lineItem.id === li.id).map((l) => ({ id: l.id, quantity: l.quantity }))),
      };
    }),
    fulfillments: fulfillments.map(({ lines: _lines, ...f }) => f),
  };
}
