const ORDER_FIELDS = /* GraphQL */ `
  id
  name
  email
  createdAt
  cancelledAt
  displayFinancialStatus
  displayFulfillmentStatus
  customer { id }
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 50) {
    nodes {
      id
      title
      sku
      quantity
      variant { id }
      product { id warranty: metafield(namespace: "custom", key: "warranty_months") { value } }
    }
  }
  fulfillments(first: 10) {
    id
    createdAt
    deliveredAt
    inTransitAt
    estimatedDeliveryAt
    displayStatus
    trackingInfo(first: 5) { company number url }
    fulfillmentLineItems(first: 50) { nodes { id quantity lineItem { id } } }
  }
`;

export const ORDERS_QUERY = /* GraphQL */ `
  query Orders($query: String!, $first: Int!) {
    orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} } }
  }
`;

export const ORDER_QUERY = /* GraphQL */ `
  query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }
`;

export const CUSTOMER_QUERY = /* GraphQL */ `
  query Customer($query: String!) {
    customers(first: 1, query: $query) { nodes { id displayName firstName defaultEmailAddress { emailAddress } numberOfOrders } }
  }
`;

export const VARIANTS_QUERY = /* GraphQL */ `
  query Variants($query: String!) {
    productVariants(first: 15, query: $query) {
      nodes { id title displayName sku price availableForSale inventoryQuantity product { title status } }
    }
  }
`;

export const DRAFT_ORDER_CREATE = /* GraphQL */ `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) { draftOrder { id name invoiceUrl } userErrors { field message } }
  }
`;

export const RETURN_REQUEST = /* GraphQL */ `
  mutation ReturnRequest($input: ReturnRequestInput!) {
    returnRequest(input: $input) { return { id name status } userErrors { field message } }
  }
`;

export const WEBHOOK_CREATE = /* GraphQL */ `
  mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { field message } }
  }
`;

export const WEBHOOKS_LIST = /* GraphQL */ `
  query Webhooks { webhookSubscriptions(first: 50) { nodes { id topic uri } } }
`;

export const SHOP_QUERY = /* GraphQL */ `query Shop { shop { name myshopifyDomain currencyCode } }`;
