import { OAuth2Client } from "google-auth-library";

export interface PushNotification {
  emailAddress: string;
  historyId: string;
  pubsubMessageId: string;
}

/** Décode le corps d'un push Pub/Sub contenant une notification Gmail. */
export function decodePushBody(body: unknown): PushNotification {
  const b = body as { message?: { data?: string; messageId?: string; message_id?: string } };
  const data = b?.message?.data;
  if (!data) throw new Error("Push Pub/Sub sans données");
  const decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as { emailAddress?: string; historyId?: string | number };
  if (!decoded.emailAddress || decoded.historyId === undefined) throw new Error("Notification Gmail invalide");
  return {
    emailAddress: decoded.emailAddress.toLowerCase(),
    historyId: String(decoded.historyId),
    pubsubMessageId: b.message?.messageId ?? b.message?.message_id ?? "",
  };
}

const verifier = new OAuth2Client();

/**
 * Vérifie le jeton OIDC signé par Google joint aux push Pub/Sub authentifiés
 * (en-tête Authorization: Bearer <jwt>). Empêche quiconque de déclencher de fausses notifications.
 */
export async function verifyPushToken(authorization: string | undefined, audience: string, serviceAccountEmail: string): Promise<void> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("Jeton OIDC absent");
  const ticket = await verifier.verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload();
  if (!payload?.email_verified || payload.email !== serviceAccountEmail) {
    throw new Error("Compte de service Pub/Sub inattendu");
  }
}
