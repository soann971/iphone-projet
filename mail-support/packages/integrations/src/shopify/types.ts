export interface ShopLineItem {
  id: string;
  title: string;
  sku: string | null;
  quantity: number;
  variantId: string | null;
  productId: string | null;
  /** Métachamp produit custom.warranty_months (null = durée par défaut). */
  warrantyMonths: number | null;
  /** Lignes d'expédition correspondantes (nécessaires pour créer un retour Shopify). */
  fulfillmentLineItems: { id: string; quantity: number }[];
}

export interface ShopFulfillment {
  id: string;
  createdAt: Date;
  deliveredAt: Date | null;
  inTransitAt: Date | null;
  estimatedDeliveryAt: Date | null;
  displayStatus: string | null;
  tracking: { company: string | null; number: string | null; url: string | null }[];
}

export interface ShopOrder {
  shopifyId: string;
  name: string;
  email: string | null;
  customerId: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
  currency: string;
  totalPrice: number;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  lineItems: ShopLineItem[];
  fulfillments: ShopFulfillment[];
}

export interface ShopCustomer {
  id: string;
  displayName: string | null;
  firstName: string | null;
  email: string | null;
  numberOfOrders: number;
}

export interface ShopVariant {
  variantId: string;
  title: string;
  productTitle: string;
  displayName: string;
  sku: string | null;
  price: number;
  availableForSale: boolean;
  inventoryQuantity: number | null;
}
