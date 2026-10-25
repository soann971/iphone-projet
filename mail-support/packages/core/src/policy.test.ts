import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@ms/shared";
import { decide, type PolicyInput } from "./policy";
import { checkReply } from "./reply-guard";

const base = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  settings: { ...DEFAULT_SETTINGS, autoSendEnabled: true },
  analysis: {
    category: "SHIPPING",
    confidence: 0.95,
    sentiment: "neutral",
    language: "fr",
    injectionSuspected: false,
    intents: { refundRequested: false, disputeOrChargeback: false, legalThreat: false, cancellationRequested: false, complaint: false, urgent: false },
  },
  draft: { confidence: 0.92, needsHuman: false, needsHumanReason: null },
  flags: [],
  guardIssues: [],
  amountInvolved: 49.9,
  isAutomatedSender: false,
  autoRepliesLast24h: 0,
  customerKnownInShopify: true,
  ...over,
});

describe("decide", () => {
  it("envoie automatiquement un cas simple et sûr", () => {
    expect(decide(base())).toMatchObject({ decision: "AUTO", reasons: [] });
  });

  it("met en validation si l'envoi auto est désactivé (défaut)", () => {
    const r = decide(base({ settings: DEFAULT_SETTINGS }));
    expect(r.decision).toBe("REVIEW");
    expect(r.reasons.join()).toMatch(/désactivé/);
  });

  it("sous le seuil de confiance → validation", () => {
    expect(decide(base({ draft: { confidence: 0.6, needsHuman: false, needsHumanReason: null } })).decision).toBe("REVIEW");
  });

  it.each([
    ["remboursement", { refundRequested: true }],
    ["litige", { disputeOrChargeback: true }],
    ["menace juridique", { legalThreat: true }],
    ["réclamation", { complaint: true }],
  ])("toujours validation humaine : %s", (_, intent) => {
    const b = base();
    const r = decide({ ...b, analysis: { ...b.analysis, intents: { ...b.analysis.intents, ...intent } } });
    expect(r.decision).toBe("REVIEW");
  });

  it("client mécontent → validation", () => {
    const b = base();
    expect(decide({ ...b, analysis: { ...b.analysis, sentiment: "angry" } }).decision).toBe("REVIEW");
  });

  it("garantie refusée → validation", () => {
    expect(decide(base({ flags: ["WARRANTY_REFUSED"] })).reasons).toContain("Garantie refusée (expirée ou non applicable)");
  });

  it("montant au-delà du seuil → validation", () => {
    expect(decide(base({ amountInvolved: 899 })).decision).toBe("REVIEW");
  });

  it("injection suspectée → validation", () => {
    const b = base();
    expect(decide({ ...b, analysis: { ...b.analysis, injectionSuspected: true } }).decision).toBe("REVIEW");
  });

  it("jamais de réponse à un répondeur automatique", () => {
    expect(decide(base({ isAutomatedSender: true })).decision).toBe("NO_REPLY");
  });

  it("spam sûr → pas de réponse ; spam incertain → validation", () => {
    const b = base();
    expect(decide({ ...b, analysis: { ...b.analysis, category: "SPAM", confidence: 0.97 } }).decision).toBe("NO_REPLY");
    expect(decide({ ...b, analysis: { ...b.analysis, category: "SPAM", confidence: 0.5 } }).decision).toBe("REVIEW");
  });

  it("anti-boucle : limite de réponses auto par fil", () => {
    expect(decide(base({ autoRepliesLast24h: 2 })).decision).toBe("REVIEW");
  });

  it("donnée non vérifiée dans la réponse → validation", () => {
    expect(decide(base({ guardIssues: [{ kind: "amount", value: "12 €" }] })).decision).toBe("REVIEW");
  });
});

describe("checkReply", () => {
  const facts = {
    allowedLiterals: ["#1052", "49,90 €", "12 mars 2026", "6A12345678901", "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901"],
    allowedDomains: ["maboutique.fr", "laposte.fr"],
    allowedEmails: ["support@maboutique.fr"],
  };

  it("accepte une réponse qui ne cite que des faits", () => {
    const body =
      "Bonjour, votre commande #1052 (49,90 €) a été expédiée le 12 mars 2026. Suivi : 6A12345678901 https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901 — écrivez-nous à support@maboutique.fr.";
    expect(checkReply({ body, ...facts })).toEqual([]);
  });

  it("signale un montant inventé", () => {
    expect(checkReply({ body: "Le remboursement sera de 59,90 €.", ...facts })).toEqual([{ kind: "amount", value: "59,90 €" }]);
  });

  it("signale une date inventée", () => {
    expect(checkReply({ body: "Livraison prévue le 15 mars 2026.", ...facts })[0]?.kind).toBe("date");
  });

  it("signale un lien hors liste blanche (ex. injecté par un mail)", () => {
    expect(checkReply({ body: "Payez ici : https://evil.example.com/pay", ...facts })[0]).toEqual({ kind: "link", value: "https://evil.example.com/pay" });
  });

  it("accepte les sous-domaines autorisés", () => {
    expect(checkReply({ body: "Voir https://aide.maboutique.fr/retours.", ...facts })).toEqual([]);
  });

  it("signale un numéro de téléphone ou un email non autorisé", () => {
    const issues = checkReply({ body: "Appelez le 06 12 34 56 78 ou écrivez à pirate@evil.com", ...facts });
    expect(issues.map((i) => i.kind).sort()).toEqual(["email", "phone"]);
  });

  it("signale une référence de suivi inventée", () => {
    expect(checkReply({ body: "Votre numéro de suivi est XY99887766FR.", ...facts })[0]?.kind).toBe("reference");
  });
});
