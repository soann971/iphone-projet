"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StatusBadge } from "@/components/Shell";
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, STATUS_TONE, timeAgo } from "@/lib/labels";
import { useApi } from "@/lib/use-api";

interface TicketRow {
  id: string;
  number: number;
  subject: string;
  status: string;
  category: string | null;
  priority: string;
  lastMessageAt: string;
  reviewReasons: string[];
  customer: { email: string; name: string | null };
  order: { name: string } | null;
  drafts: { id: string; status: string; confidence: number }[];
  _count: { messages: number };
}

const TABS = [
  { key: "review", label: "À valider" },
  { key: "open", label: "En cours" },
  { key: "done", label: "Traités" },
  { key: "spam", label: "Spam" },
  { key: "", label: "Tous" },
];

function TicketList() {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get("status") ?? "review";
  const category = params.get("category") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [q, setQ] = useState(params.get("q") ?? "");

  const query = new URLSearchParams({ ...(status ? { status } : {}), ...(category ? { category } : {}), ...(params.get("q") ? { q: params.get("q")! } : {}), page: String(page) });
  const { data, error, loading, reload } = useApi<{ total: number; items: TicketRow[]; pageSize: number }>(`/api/tickets?${query}`);

  useEffect(() => {
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!("page" in patch)) next.delete("page");
    router.push(`/tickets?${next}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tickets</h1>
          <p className="muted">Chaque fil Gmail est un ticket. Les réponses sensibles attendent votre validation.</p>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q });
          }}
        >
          <input placeholder="Rechercher (sujet, email, n° de ticket)" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
          <select value={category} onChange={(e) => go({ category: e.target.value })} style={{ width: 160 }} aria-label="Catégorie">
            <option value="">Toutes catégories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </form>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={status === t.key} className={status === t.key ? "active" : ""} onClick={() => go({ status: t.key || "all" })}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Client</th>
                <th>Sujet</th>
                <th>Catégorie</th>
                <th>Statut</th>
                <th>Commande</th>
                <th>Dernier message</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => router.push(`/tickets/${t.id}`)}>
                  <td className="mono">#{t.number}</td>
                  <td>
                    <div>{t.customer.name ?? t.customer.email}</div>
                    {t.customer.name && <div className="muted small">{t.customer.email}</div>}
                  </td>
                  <td style={{ maxWidth: 380 }}>
                    <div>{t.subject}</div>
                    {t.reviewReasons.length > 0 && <div className="small" style={{ color: "var(--warning)" }}>{t.reviewReasons.slice(0, 2).join(" · ")}</div>}
                  </td>
                  <td>{t.category ? CATEGORY_LABELS[t.category] : <span className="muted">—</span>}</td>
                  <td>
                    <div className="row">
                      <StatusBadge label={STATUS_LABELS[t.status] ?? t.status} tone={STATUS_TONE[t.status]} />
                      {(t.priority === "HIGH" || t.priority === "URGENT") && <StatusBadge label={PRIORITY_LABELS[t.priority]!} tone="serious" />}
                    </div>
                  </td>
                  <td>{t.order?.name ?? <span className="muted">—</span>}</td>
                  <td className="muted small" title={new Date(t.lastMessageAt).toLocaleString("fr-FR")}>
                    {timeAgo(t.lastMessageAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && data?.items.length === 0 && <div className="empty">Aucun ticket ici. 🎉</div>}
        {loading && !data && <div className="empty">Chargement…</div>}
      </div>
      {data && data.total > data.pageSize && (
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <span className="muted small">
            {data.total} tickets · page {page}/{Math.ceil(data.total / data.pageSize)}
          </span>
          <button className="btn small" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>
            Précédent
          </button>
          <button className="btn small" disabled={page * data.pageSize >= data.total} onClick={() => go({ page: String(page + 1) })}>
            Suivant
          </button>
        </div>
      )}
    </>
  );
}

export default function TicketsPage() {
  return (
    <Suspense>
      <TicketList />
    </Suspense>
  );
}
