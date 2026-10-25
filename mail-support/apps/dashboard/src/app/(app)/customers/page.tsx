"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDateTime } from "@/lib/labels";
import { useApi } from "@/lib/use-api";

interface Row {
  id: string;
  email: string;
  name: string | null;
  lastContactAt: string | null;
  shopifyCustomerId: string | null;
  _count: { tickets: number; orders: number };
}

export default function CustomersPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useApi<{ total: number; items: Row[] }>(`/api/customers?page=${page}${search ? `&q=${encodeURIComponent(search)}` : ""}`);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p className="muted">Clients identifiés par leur adresse email. Export et effacement RGPD depuis la fiche client.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q);
          }}
        >
          <input placeholder="Rechercher un client" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        </form>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Tickets</th>
                <th>Commandes en cache</th>
                <th>Shopify</th>
                <th>Dernier contact</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => router.push(`/customers/${c.id}`)}>
                  <td>
                    <div>{c.name ?? c.email}</div>
                    {c.name && <div className="muted small">{c.email}</div>}
                  </td>
                  <td>{c._count.tickets}</td>
                  <td>{c._count.orders}</td>
                  <td>{c.shopifyCustomerId ? "Oui" : "—"}</td>
                  <td className="muted small">{fmtDateTime(c.lastContactAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.items.length === 0 && <div className="empty">Aucun client.</div>}
      </div>
      {data && data.total > 25 && (
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Précédent
          </button>
          <button className="btn small" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>
            Suivant
          </button>
        </div>
      )}
    </>
  );
}
