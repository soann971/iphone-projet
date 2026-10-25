import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac } from "node:crypto";
import { safeEqual } from "@ms/crypto";
import type { UserRole } from "@ms/db";

export const SESSION_COOKIE = "ms_session";
const SESSION_TTL_MS = 12 * 3600_000;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("base64url");

/** Jeton de session signé (HMAC) : uid + expiration. Le rôle est relu en base à chaque requête. */
export function createSessionToken(secret: string, userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + SESSION_TTL_MS })).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function readSessionToken(secret: string, token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(secret, payload))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: string; exp: number };
    return exp > now ? uid : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_MS / 1000,
});

const RANK: Record<UserRole, number> = { VIEWER: 0, AGENT: 1, ADMIN: 2 };

/** preHandler : exige une session et un rôle minimal. */
export function requireRole(min: UserRole) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "Non authentifié" });
    if (RANK[req.user.role] < RANK[min]) return reply.code(403).send({ error: "Droits insuffisants" });
  };
}
