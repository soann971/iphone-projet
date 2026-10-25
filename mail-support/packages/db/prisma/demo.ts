/**
 * Données de démonstration (développement uniquement) : quelques tickets réalistes pour explorer le dashboard.
 * Usage : pnpm --filter @ms/db demo
 */
import { getDb, disconnectDb } from "../src/client";

const db = getDb();
const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600_000);

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Interdit en production");
  const account = await db.gmailAccount.upsert({
    where: { email: "support@demo.test" },
    create: { email: "support@demo.test", encryptedRefreshToken: "", scopes: "", active: false },
    update: {},
  });

  const samples = [
    {
      email: "jeanne.martin@exemple.fr", name: "Jeanne Martin", subject: "Retour iPhone 13", category: "RETURN" as const, status: "PENDING_REVIEW" as const, h: 2,
      body: "Bonjour,\nJ'ai reçu mon iPhone 13 il y a 5 jours (commande #1081) mais il ne me convient pas. Comment faire le retour ?\nMerci",
      reasons: ["Montant supérieur au seuil (150 €)"],
      draft: "Bonjour Jeanne,\n\nMerci pour votre message. Votre demande de rétractation pour la commande #1081 est bien dans le délai légal.\n\nVous trouverez en pièce jointe le bon de retour RET-2026-00007 avec la procédure à suivre. Pensez à désactiver « Localiser mon iPhone » avant l'envoi.\n\nBien cordialement,",
      summary: "La cliente souhaite se rétracter pour l'iPhone 13 reçu il y a 5 jours.", confidence: 0.94, sentiment: "neutral",
    },
    {
      email: "achats@entreprise-exemple.fr", name: "Service achats", subject: "Demande de devis", category: "QUOTE" as const, status: "PENDING_REVIEW" as const, h: 5,
      body: "Bonjour,\nPourriez-vous nous faire un devis pour 10 iPhone 13 128 Go grade A et 10 coques ?\nCordialement",
      reasons: ["Montant supérieur au seuil (150 €)"],
      draft: "Bonjour,\n\nMerci pour votre demande. Vous trouverez ci-joint notre devis DEV-2026-00042 d'un montant de 3 648,00 € TTC, valable jusqu'au 24 novembre 2026.\n\nVous pouvez le valider et le régler directement en ligne via le lien indiqué dans le devis.\n\nBien cordialement,",
      summary: "Demande de devis pour 10 iPhone 13 et 10 coques.", confidence: 0.91, sentiment: "neutral",
    },
    {
      email: "client.colere@exemple.fr", name: "Marc Leroy", subject: "INADMISSIBLE", category: "AFTER_SALES" as const, status: "ESCALATED" as const, h: 7,
      body: "C'EST LA TROISIÈME FOIS QUE JE VOUS ÉCRIS !!! Le téléphone redémarre tout seul. Je veux être remboursé.",
      reasons: ["Demande de remboursement", "Client mécontent", "Réclamation"],
      draft: "Bonjour Monsieur Leroy,\n\nNous sommes sincèrement désolés pour ces désagréments et pour l'attente. Votre demande est transmise en priorité à un conseiller qui reviendra vers vous très rapidement.\n\nAfin d'accélérer le traitement, pourriez-vous nous indiquer votre numéro de commande ?\n\nBien cordialement,",
      summary: "Client très mécontent : téléphone qui redémarre, demande de remboursement.", confidence: 0.72, sentiment: "angry",
    },
    {
      email: "paul.durand@exemple.fr", name: "Paul Durand", subject: "Où est mon colis ?", category: "SHIPPING" as const, status: "AUTO_REPLIED" as const, h: 26,
      body: "Bonjour, j'ai commandé il y a une semaine (commande 1060), où en est mon colis ?", reasons: [],
      draft: "Bonjour Paul,\n\nVotre commande #1060 est en cours d'acheminement avec Colissimo. Vous pouvez suivre votre colis ici : https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901\n\nBien cordialement,",
      summary: "Le client demande le suivi de la commande #1060.", confidence: 0.97, sentiment: "neutral",
    },
  ];

  for (const s of samples) {
    const customer = await db.customer.upsert({ where: { email: s.email }, create: { email: s.email, name: s.name, lastContactAt: ago(s.h) }, update: {} });
    const threadId = `demo-${s.email}`;
    if (await db.ticket.findUnique({ where: { gmailThreadId: threadId } })) continue;
    const ticket = await db.ticket.create({
      data: {
        gmailThreadId: threadId, gmailAccountId: account.id, customerId: customer.id, subject: s.subject, category: s.category, status: s.status,
        priority: s.sentiment === "angry" ? "HIGH" : "NORMAL", reviewReasons: s.reasons, lastMessageAt: ago(s.h), createdAt: ago(s.h),
        firstResponseAt: s.status === "AUTO_REPLIED" ? ago(s.h - 0.05) : null,
      },
    });
    const msg = await db.message.create({
      data: { ticketId: ticket.id, gmailMessageId: `demo-${ticket.id}`, direction: "INBOUND", fromEmail: s.email, fromName: s.name, subject: s.subject, bodyText: s.body, bodyFull: s.body, receivedAt: ago(s.h) },
    });
    await db.aiAnalysis.create({
      data: {
        messageId: msg.id, ticketId: ticket.id, model: "claude-opus-5-5", promptVersion: "demo", category: s.category, confidence: s.confidence, language: "fr",
        sentiment: s.sentiment, summary: s.summary, extracted: {}, intents: {}, riskFlags: s.sentiment === "angry" ? ["refundRequested", "sentiment:angry"] : [],
      },
    });
    const sent = s.status === "AUTO_REPLIED";
    await db.draftReply.create({
      data: {
        ticketId: ticket.id, replyToMessageId: msg.id, subject: `Re: ${s.subject}`, body: s.draft, decision: sent ? "AUTO" : "REVIEW",
        confidence: s.confidence, reviewReasons: s.reasons, status: sent ? "SENT" : "DRAFT", sentAt: sent ? ago(s.h - 0.05) : null, facts: { missing: [], flags: [] },
      },
    });
    if (sent) {
      await db.message.create({
        data: { ticketId: ticket.id, gmailMessageId: `demo-out-${ticket.id}`, direction: "OUTBOUND", fromEmail: "support@demo.test", subject: `Re: ${s.subject}`, bodyText: s.draft, bodyFull: s.draft, receivedAt: ago(s.h - 0.05) },
      });
    }
  }
  console.log("Données de démonstration créées.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
}).finally(disconnectDb);
