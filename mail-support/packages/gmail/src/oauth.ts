import { OAuth2Client } from "google-auth-library";

/**
 * Portées demandées :
 * - gmail.modify : lire, libeller, archiver ET envoyer (inclut l'envoi), sans suppression définitive.
 * - openid + email : connaître l'adresse de la boîte connectée.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify", "openid", "email"];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function createOAuthClient(cfg: GoogleOAuthConfig): OAuth2Client {
  return new OAuth2Client({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri });
}

/** URL de consentement Google. `state` protège contre le CSRF (vérifié au retour). */
export function buildAuthUrl(cfg: GoogleOAuthConfig, state: string, loginHint?: string): string {
  return createOAuthClient(cfg).generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // garantit l'obtention d'un refresh token
    scope: GMAIL_SCOPES,
    state,
    include_granted_scopes: true,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
}

export interface ExchangedTokens {
  email: string;
  refreshToken: string;
  scopes: string;
}

export async function exchangeCode(cfg: GoogleOAuthConfig, code: string): Promise<ExchangedTokens> {
  const client = createOAuthClient(cfg);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google n'a pas renvoyé de refresh token. Révoquez l'accès de l'application dans votre compte Google puis recommencez.");
  }
  if (!tokens.id_token) throw new Error("Jeton d'identité manquant (portée openid email)");
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: cfg.clientId });
  const email = ticket.getPayload()?.email;
  if (!email) throw new Error("Adresse email introuvable dans le jeton d'identité");
  const granted = tokens.scope ?? "";
  if (!granted.includes("gmail.modify")) throw new Error("La portée gmail.modify n'a pas été accordée");
  return { email: email.toLowerCase(), refreshToken: tokens.refresh_token, scopes: granted };
}
