"use client";
import { useState } from "react";

/**
 * Histogramme des tickets reçus par jour (une seule série : pas de légende, le titre la nomme).
 * Barres ≤ 24 px, extrémité arrondie 4 px, quadrillage discret, info-bulle au survol / focus,
 * et vue tableau pour l'accessibilité.
 */
export function DailyChart({ data }: { data: { day: string; received: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 720;
  const H = 220;
  const pad = { l: 36, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...data.map((d) => d.received));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const band = (W - pad.l - pad.r) / Math.max(1, data.length);
  const barW = Math.min(24, band - 2);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const fmtDay = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  return (
    <div className="viz-root">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Tickets reçus par jour</h2>
        <button className="btn small" onClick={() => setTable(!table)}>
          {table ? "Voir le graphique" : "Voir les données"}
        </button>
      </div>
      {data.length === 0 ? (
        <p className="muted">Pas encore de données.</p>
      ) : table ? (
        <table style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Jour</th>
              <th>Tickets</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <td>{fmtDay(d.day)}</td>
                <td>{d.received}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ position: "relative", marginTop: 8 }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Nombre de tickets reçus par jour">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-3)">
                  {t}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = pad.l + i * band + (band - barW) / 2;
              const h = Math.max(0, y(0) - y(d.received));
              const r = Math.min(4, h, barW / 2);
              return (
                <g
                  key={d.day}
                  tabIndex={0}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  style={{ outline: "none" }}
                >
                  {/* zone de survol plus large que la barre */}
                  <rect x={pad.l + i * band} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" />
                  {h > 0 && (
                    <path
                      d={`M${x},${y(0)} V${y(d.received) + r} Q${x},${y(d.received)} ${x + r},${y(d.received)} H${x + barW - r} Q${x + barW},${y(d.received)} ${x + barW},${y(d.received) + r} V${y(0)} Z`}
                      fill="var(--series-1)"
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  )}
                </g>
              );
            })}
            <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--text-3)" strokeWidth={1} />
            {[0, Math.floor((data.length - 1) / 2), data.length - 1]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((i) => (
                <text key={i} x={pad.l + i * band + band / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-3)">
                  {fmtDay(data[i]!.day)}
                </text>
              ))}
          </svg>
          {hover !== null && data[hover] && (
            <div
              role="status"
              style={{
                position: "absolute",
                left: `${((pad.l + hover * band + band / 2) / W) * 100}%`,
                top: 0,
                transform: "translateX(-50%)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "4px 10px",
                boxShadow: "var(--shadow)",
                pointerEvents: "none",
                whiteSpace: "nowrap",
              }}
            >
              <strong>{data[hover].received}</strong> <span className="muted small">ticket(s) · {fmtDay(data[hover].day)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return Math.max(1, m * pow);
  return pow * 10;
}
