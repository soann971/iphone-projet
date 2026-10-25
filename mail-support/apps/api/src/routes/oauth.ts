import type { FastifyPluginAsync } from "fastify";
import { connectGmailAccount, type AppContext } from "@ms/app";
import { randomToken } from "@ms/crypto";
import { buildAuthUrl, exchangeCode } from "@ms/gmail";
import { requireRole } from "../auth";

const STATE_COOKIE = "ms_oauth_state";

/** Connexion de la boîte Gmail (consentement OAuth Google), réservée aux administrateurs. */
export const oauthRoutes =
  (ctx: AppContext): FastifyPluginAsync =>
  async (app) => {
    app.get("/oauth/google/start", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
      if (!ctx.google.clientId) return reply.code(400).send({ error: "GOOGLE_CLIENT_ID non configuré" });
      const state = randomToken(24);
      reply.setCookie(STATE_COOKIE, state, { httpOnly: true, secure: ctx.env.NODE_ENV === "production", sameSite: "lax", path: "/oauth", maxAge: 600, signed: true });
      const hint = (req.query as { email?: string }).email;
      return reply.redirect(buildAuthUrl(ctx.google, state, hint));
    });

    app.get("/oauth/google/callback", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
      const q = req.query as { code?: string; state?: string; error?: string };
      const cookie = req.unsignCookie(req.cookies[STATE_COOKIE] ?? "");
      reply.clearCookie(STATE_COOKIE, { path: "/oauth" });
      const back = (status: string) => reply.redirect(`${ctx.env.DASHBOARD_URL}/settings?gmail=${encodeURIComponent(status)}`);
      if (q.error) return back(q.error);
      if (!q.code || !q.state || !cookie.valid || cookie.value !== q.state) return back("etat_invalide");
      try {
        const tokens = await exchangeCode(ctx.google, q.code);
        await connectGmailAccount(ctx, tokens, req.user!.id);
        return back("ok");
      } catch (err) {
        req.log.error({ err }, "connexion Gmail impossible");
        return back((err as Error).message.slice(0, 200));
      }
    });
  };
