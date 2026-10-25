import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createTestContext, fakeAi, resetDb } from "@ms/app/testing";
import { hashPassword } from "@ms/crypto";
import { disconnectDb } from "@ms/db";
import { buildServer } from "./server";

const enabled = !!process.env.TEST_DATABASE_URL;

async function setup() {
  process.env.SHOPIFY_CLIENT_SECRET = "shpsecret";
  process.env.PUBSUB_SKIP_VERIFY = "true";
  const ai = fakeAi({ classify: () => { throw new Error("non utilisé"); }, draft: () => { throw new Error("non utilisé"); } });
  const t = await createTestContext({ ai, shopify: null });
  const app = await buildServer(t.ctx);
  const admin = await t.ctx.db.user.create({ data: { email: "admin@b.test", name: "Admin", role: "ADMIN", passwordHash: hashPassword("motdepasse-solide") } });
  await t.ctx.db.user.create({ data: { email: "lecteur@b.test", name: "Lecteur", role: "VIEWER", passwordHash: hashPassword("motdepasse-solide") } });
  const login = async (email: string) => {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-ms-csrf": "1" }, payload: { email, password: "motdepasse-solide" } });
    expect(r.statusCode).toBe(200);
    return r.cookies.find((c) => c.name === "ms_session")!.value;
  };
  return { ...t, app, admin, login };
}

async function seedTicket(t: Awaited<ReturnType<typeof setup>>) {
  const customer = await t.ctx.db.customer.create({ data: { email: "c@x.test" } });
  const ticket = await t.ctx.db.ticket.create({ data: { gmailThreadId: "th1", gmailAccountId: t.account.id, customerId: customer.id, subject: "Question", status: "PENDING_REVIEW" } });
  const draft = await t.ctx.db.draftReply.create({ data: { ticketId: ticket.id, subject: "Re: Question", body: "Bonjour", decision: "REVIEW" } });
  return { customer, ticket, draft };
}

describe.skipIf(!enabled)("API", () => {
  beforeEach(resetDb);
  afterAll(disconnectDb);

  it("refuse un mauvais mot de passe et protège les routes", async () => {
    const t = await setup();
    const bad = await t.app.inject({ method: "POST", url: "/api/auth/login", headers: { "x-ms-csrf": "1" }, payload: { email: "admin@b.test", password: "nope" } });
    expect(bad.statusCode).toBe(401);
    expect((await t.app.inject({ url: "/api/tickets" })).statusCode).toBe(401);
    expect(await t.ctx.db.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(1);
  });

  it("exige l'en-tête CSRF sur les requêtes modifiantes", async () => {
    const t = await setup();
    const r = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@b.test", password: "motdepasse-solide" } });
    expect(r.statusCode).toBe(403);
  });

  it("liste et détaille les tickets, valide un brouillon (mis en file d'envoi)", async () => {
    const t = await setup();
    const { ticket, draft } = await seedTicket(t);
    const cookie = await t.login("admin@b.test");
    const list = await t.app.inject({ url: "/api/tickets?status=review", cookies: { ms_session: cookie } });
    expect(list.json().total).toBe(1);
    const detail = await t.app.inject({ url: `/api/tickets/${ticket.id}`, cookies: { ms_session: cookie } });
    expect(detail.json().drafts).toHaveLength(1);

    const edit = await t.app.inject({ method: "PATCH", url: `/api/drafts/${draft.id}`, cookies: { ms_session: cookie }, headers: { "x-ms-csrf": "1" }, payload: { body: "Bonjour, voici la réponse." } });
    expect(edit.statusCode).toBe(200);
    const ok = await t.app.inject({ method: "POST", url: `/api/drafts/${draft.id}/approve`, cookies: { ms_session: cookie }, headers: { "x-ms-csrf": "1" } });
    expect(ok.statusCode).toBe(200);
    expect(t.queues.jobs.send).toEqual([draft.id]);
    const again = await t.app.inject({ method: "POST", url: `/api/drafts/${draft.id}/approve`, cookies: { ms_session: cookie }, headers: { "x-ms-csrf": "1" } });
    expect(again.statusCode).toBe(409);
    const row = await t.ctx.db.draftReply.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row).toMatchObject({ status: "APPROVED", approvedById: t.admin.id, body: "Bonjour, voici la réponse." });
  });

  it("un lecteur ne peut ni valider ni modifier les paramètres", async () => {
    const t = await setup();
    const { draft } = await seedTicket(t);
    const cookie = await t.login("lecteur@b.test");
    const h = { cookies: { ms_session: cookie }, headers: { "x-ms-csrf": "1" } };
    expect((await t.app.inject({ method: "POST", url: `/api/drafts/${draft.id}/approve`, ...h })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "PUT", url: "/api/settings", ...h, payload: { autoSendEnabled: true } })).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/api/settings", cookies: { ms_session: cookie } })).statusCode).toBe(200);
  });

  it("modifie les paramètres (validés) et journalise", async () => {
    const t = await setup();
    const cookie = await t.login("admin@b.test");
    const h = { cookies: { ms_session: cookie }, headers: { "x-ms-csrf": "1" } };
    const bad = await t.app.inject({ method: "PUT", url: "/api/settings", ...h, payload: { confidenceThreshold: 3 } });
    expect(bad.statusCode).toBe(400);
    const ok = await t.app.inject({ method: "PUT", url: "/api/settings", ...h, payload: { autoSendEnabled: true, confidenceThreshold: 0.9 } });
    expect(ok.json()).toMatchObject({ autoSendEnabled: true, confidenceThreshold: 0.9 });
    expect(await t.ctx.db.auditLog.count({ where: { action: "settings.updated" } })).toBe(1);
  });

  it("webhook Shopify : signature vérifiée et idempotence", async () => {
    const t = await setup();
    const body = JSON.stringify({ admin_graphql_api_id: "gid://shopify/Order/1" });
    const sig = createHmac("sha256", "shpsecret").update(body).digest("base64");
    const headers = { "content-type": "application/json", "x-shopify-topic": "orders/updated", "x-shopify-webhook-id": "w1" };
    expect((await t.app.inject({ method: "POST", url: "/webhooks/shopify", headers: { ...headers, "x-shopify-hmac-sha256": "faux" }, payload: body })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/webhooks/shopify", headers: { ...headers, "x-shopify-hmac-sha256": sig }, payload: body })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "POST", url: "/webhooks/shopify", headers: { ...headers, "x-shopify-hmac-sha256": sig }, payload: body })).statusCode).toBe(200);
    expect(t.queues.jobs.shopify).toEqual([{ topic: "orders/updated", orderId: "gid://shopify/Order/1", customerEmail: undefined }]);
  });

  it("webhook Gmail (Pub/Sub) : déclenche la synchronisation de la bonne boîte", async () => {
    const t = await setup();
    const data = Buffer.from(JSON.stringify({ emailAddress: "support@boutique.test", historyId: 42 })).toString("base64");
    const r = await t.app.inject({ method: "POST", url: "/webhooks/gmail", headers: { "content-type": "application/json" }, payload: { message: { data, messageId: "m1" } } });
    expect(r.statusCode).toBe(204);
    expect(t.queues.jobs.sync).toEqual([t.account.id]);
  });

  it("effacement RGPD réservé aux administrateurs, avec motif", async () => {
    const t = await setup();
    const { customer } = await seedTicket(t);
    const viewer = await t.login("lecteur@b.test");
    const h = (c: string) => ({ cookies: { ms_session: c }, headers: { "x-ms-csrf": "1" } });
    expect((await t.app.inject({ method: "DELETE", url: `/api/customers/${customer.id}`, ...h(viewer), payload: { reason: "demande" } })).statusCode).toBe(403);
    const admin = await t.login("admin@b.test");
    expect((await t.app.inject({ method: "DELETE", url: `/api/customers/${customer.id}`, ...h(admin), payload: { reason: "demande du client" } })).statusCode).toBe(200);
    expect(await t.ctx.db.customer.count()).toBe(0);
  });
});
