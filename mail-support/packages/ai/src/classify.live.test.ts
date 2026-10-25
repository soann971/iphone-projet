/**
 * Évaluation RÉELLE de la classification sur les mails anonymisés (appels payants à l'API Claude).
 * Lancement : RUN_LIVE_AI=1 ANTHROPIC_API_KEY=sk-ant-… pnpm test packages/ai
 */
import { describe, expect, it } from "vitest";
import { ClaudeProvider } from "./client";
import { loadFixtures } from "./fixtures";

const live = process.env.RUN_LIVE_AI === "1" && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!live)("classification réelle (Claude)", () => {
  const provider = new ClaudeProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_MODEL ?? "claude-opus-5-5",
    classifyEffort: "low",
    draftEffort: "medium",
    fallbacks: true,
  });
  const fixtures = loadFixtures();

  it(
    "atteint au moins 90 % de bonne catégorie et respecte les signaux critiques",
    async () => {
      const results = await Promise.all(
        fixtures.map(async (f) => ({ f, a: (await provider.classify({ ...f, receivedAt: "2026-10-25" })).output })),
      );
      const wrong = results.filter(({ f, a }) => a.category !== f.expected.category);
      for (const { f, a } of wrong) console.warn(`✗ ${f.id}: attendu ${f.expected.category}, obtenu ${a.category} (${a.confidence})`);
      expect(1 - wrong.length / results.length).toBeGreaterThanOrEqual(0.9);

      for (const { f, a } of results) {
        if (f.expected.injection) expect(a.injectionSuspected, f.id).toBe(true);
        if (f.expected.refundRequested) expect(a.intents.refundRequested, f.id).toBe(true);
        if (f.expected.angry) expect(["angry", "negative"], f.id).toContain(a.sentiment);
        for (const n of f.expected.orderNumbers ?? []) expect(a.extracted.orderNumbers, f.id).toContain(n);
      }
    },
    180_000,
  );
});
