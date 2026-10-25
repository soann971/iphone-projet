"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge, useMe } from "@/components/Shell";
import { api } from "@/lib/api";
import { CATEGORY_LABELS, fmtDate, fmtDateTime, fmtEuro, STATUS_LABELS, STATUS_TONE } from "@/lib/labels";
import { useApi } from "@/lib/use-api";

interface Customer {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  lastContactAt: string | null;
  tickets: { id: string; number: number; subject: string; status: string; category: string | null; lastMessageAt: string }[];
  orders: { id: string; name: string; orderedAt: string; totalPrice: string; fulfillmentStatus: string | null }[];
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const router = useRouter();
  const { data: c, error } = useApi<Customer>(`/api/customers/${id}`);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  if (error) return <div className="alert error">{error}</div>;
  if (!c) return <div className="empty">Chargement…</div>;

  async function erase() {
    try {
      await api(`/api/customers/${id}`, { method: "DELETE", json: { reason } });
      router.push("/customers");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted small">
            <Link href="/customers">← Clients</Link>
          </div>
          <h1>{c.name ?? c.email}</h1>
          <p className="muted">
            {c.email} · client depuis le {fmtDate(c.createdAt)} · dernier contact {fmtDateTime(c.lastContactAt)}
          </p>
        </div>
        {me?.role === "ADMIN" && (
          <a className="btn" href={`/api/customers/${id}/export`}>
            Exporter ses données (RGPD)
          </a>
        )}
      </div>
      <div className="grid-2">
        <div className="stack">
          <section className="card">
            <h2>Tickets</h2>
            <table>
              <tbody>
                {c.tickets.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => router.push(`/tickets/${t.id}`)}>
                    <td className="mono">#{t.number}</td>
                    <td>{t.subject}</td>
                    <td>{t.category ? CATEGORY_LABELS[t.category] : "—"}</td>
                    <td>
                      <StatusBadge label={STATUS_LABELS[t.status] ?? t.status} tone={STATUS_TONE[t.status]} />
                    </td>
                    <td className="muted small">{fmtDateTime(t.lastMessageAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2>Commandes Shopify (cache)</h2>
            {c.orders.length === 0 && <p className="muted">Aucune commande en cache.</p>}
            <table>
              <tbody>
                {c.orders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{fmtDate(o.orderedAt)}</td>
                    <td>{fmtEuro(o.totalPrice)}</td>
                    <td className="muted">{o.fulfillmentStatus ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        {me?.role === "ADMIN" && (
          <section className="card stack">
            <h2 style={{ color: "var(--critical)" }}>Droit à l&apos;effacement</h2>
            <p className="muted small">
              Supprime définitivement le client, ses tickets, messages, analyses, réponses, dossiers et PDF de ce logiciel. Les mails restent dans Gmail et les
              commandes dans Shopify : supprimez-les aussi si nécessaire.
            </p>
            <label className="field">
              Motif
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Demande du client du …" />
            </label>
            <label className="field">
              Tapez l&apos;email du client pour confirmer
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button className="btn danger" disabled={reason.length < 3 || confirm.trim().toLowerCase() !== c.email} onClick={erase}>
              Effacer définitivement
            </button>
            {msg && <div className="alert error">{msg}</div>}
          </section>
        )}
      </div>
    </>
  );
}
