import { hmacSha256Base64, safeEqual } from "@ms/crypto";

/**
 * Vérifie la signature d'un webhook Shopify (en-tête X-Shopify-Hmac-Sha256),
 * calculée avec le secret client de l'application sur le corps BRUT de la requête.
 */
export function verifyShopifyWebhook(rawBody: Buffer | string, hmacHeader: string | undefined, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  return safeEqual(hmacSha256Base64(secret, rawBody), hmacHeader);
}
