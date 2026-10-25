import type { AppContext } from "./context";

/** Indicateurs du dashboard sur une période. */
export async function computeStats(ctx: AppContext, days = 30) {
  const since = new Date(ctx.now().getTime() - days * 86_400_000);
  const db = ctx.db;
  const [byCategory, byStatus, drafts, firstResponse, aiUsage, pending, daily] = await Promise.all([
    db.ticket.groupBy({ by: ["category"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    db.draftReply.groupBy({ by: ["decision", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.$queryRaw<{ avg_minutes: number | null; median_minutes: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 60)::float AS avg_minutes,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 60)::float AS median_minutes
      FROM "Ticket" WHERE "firstResponseAt" IS NOT NULL AND "createdAt" >= ${since}`,
    db.aiAnalysis.aggregate({ where: { createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true }, _avg: { confidence: true }, _count: { _all: true } }),
    db.ticket.count({ where: { status: { in: ["PENDING_REVIEW", "ESCALATED", "ERROR"] } } }),
    db.$queryRaw<{ day: Date; received: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*) AS received
      FROM "Ticket" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
  ]);
  const sent = drafts.filter((d) => d.status === "SENT");
  const autoSent = sent.filter((d) => d.decision === "AUTO").reduce((s, d) => s + d._count._all, 0);
  const totalSent = sent.reduce((s, d) => s + d._count._all, 0);
  return {
    periodDays: days,
    pendingReview: pending,
    byCategory: Object.fromEntries(byCategory.map((r) => [r.category ?? "NON_CLASSE", r._count._all])),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    replies: { total: totalSent, auto: autoSent, autoRate: totalSent ? autoSent / totalSent : 0 },
    firstResponseMinutes: { avg: firstResponse[0]?.avg_minutes ?? null, median: firstResponse[0]?.median_minutes ?? null },
    ai: {
      analyses: aiUsage._count._all,
      avgConfidence: aiUsage._avg.confidence,
      inputTokens: aiUsage._sum.inputTokens ?? 0,
      outputTokens: aiUsage._sum.outputTokens ?? 0,
    },
    daily: fillDays(since, ctx.now(), daily),
  };
}

/** Série continue (jours sans ticket = 0) pour un histogramme lisible. */
function fillDays(from: Date, to: Date, rows: { day: Date; received: bigint }[]) {
  const map = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.received)]));
  const out: { day: string; received: number }[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1));
  for (; d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, received: map.get(key) ?? 0 });
  }
  return out;
}
