"use client";
import { useState } from "react";
import { DailyChart } from "@/components/DailyChart";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/labels";
import { useApi } from "@/lib/use-api";

interface Stats {
  periodDays: number;
  pendingReview: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  replies: { total: number; auto: number; autoRate: number };
  firstResponseMinutes: { avg: number | null; median: number | null };
  ai: { analyses: number; avgConfidence: number | null; inputTokens: number; outputTokens: number };
  daily: { day: string; received: number }[];
}

const fmtMinutes = (m: number | null) => (m === null ? "—" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1).replace(".", ",")} h` : `${(m / 1440).toFixed(1).replace(".", ",")} j`);

export default function StatsPage() {
  const [days, setDays] = useState(30);
  const { data: s } = useApi<Stats>(`/api/stats?days=${days}`);
  const cats = s ? Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]) : [];
  const catMax = Math.max(1, ...cats.map((c) => c[1]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Statistiques</h1>
          <p className="muted">Volume, taux d&apos;automatisation et délais de réponse.</p>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 180 }} aria-label="Période">
          <option value={7}>7 derniers jours</option>
          <option value={30}>30 derniers jours</option>
          <option value={90}>90 derniers jours</option>
          <option value={365}>12 derniers mois</option>
        </select>
      </div>
      {!s ? (
        <div className="empty">Chargement…</div>
      ) : (
        <div className="stack">
          <div className="grid-tiles">
            <Tile label="Tickets reçus" value={String(s.daily.reduce((a, d) => a + d.received, 0))} />
            <Tile label="À valider maintenant" value={String(s.pendingReview)} />
            <Tile label="Réponses envoyées" value={String(s.replies.total)} />
            <Tile label="Part envoyée automatiquement" value={`${Math.round(s.replies.autoRate * 100)} %`} />
            <Tile label="Délai médian 1re réponse" value={fmtMinutes(s.firstResponseMinutes.median)} />
            <Tile label="Confiance IA moyenne" value={s.ai.avgConfidence === null ? "—" : `${Math.round(s.ai.avgConfidence * 100)} %`} />
          </div>
          <section className="card">
            <DailyChart data={s.daily} />
          </section>
          <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <section className="card">
              <h2>Par catégorie</h2>
              {cats.length === 0 && <p className="muted">Aucune donnée.</p>}
              {cats.map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "110px 1fr 40px", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <span className="small">{CATEGORY_LABELS[k] ?? "Non classé"}</span>
                  <div style={{ height: 14, background: "var(--surface-2)", borderRadius: 4 }}>
                    <div style={{ width: `${(v / catMax) * 100}%`, height: "100%", background: "var(--series-1)", borderRadius: "0 4px 4px 0" }} />
                  </div>
                  <span className="small" style={{ textAlign: "right" }}>
                    {v}
                  </span>
                </div>
              ))}
            </section>
            <section className="card">
              <h2>Tickets par statut (tous)</h2>
              <table>
                <tbody>
                  {Object.entries(s.byStatus).map(([k, v]) => (
                    <tr key={k}>
                      <td>{STATUS_LABELS[k] ?? k}</td>
                      <td style={{ textAlign: "right" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small" style={{ marginTop: 12 }}>
                IA : {s.ai.analyses} analyses · {(s.ai.inputTokens / 1000).toFixed(0)} k jetons en entrée · {(s.ai.outputTokens / 1000).toFixed(0)} k en sortie
              </p>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card tile">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
