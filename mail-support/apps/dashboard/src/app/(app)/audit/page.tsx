"use client";
import { useState } from "react";
import { fmtDateTime } from "@/lib/labels";
import { useApi } from "@/lib/use-api";

interface Entry {
  id: string;
  at: string;
  actorType: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: unknown;
  ip: string | null;
}

const ACTORS: Record<string, string> = { USER: "Utilisateur", SYSTEM: "Système", AI: "IA", CUSTOMER: "Client" };

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const { data } = useApi<{ total: number; items: Entry[] }>(`/api/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ""}`);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Journal d&apos;audit</h1>
          <p className="muted">Qui a fait quoi, et quand. Aucun contenu de mail n&apos;y est enregistré.</p>
        </div>
        <select value={action} onChange={(e) => (setPage(1), setAction(e.target.value))} style={{ width: 220 }} aria-label="Filtrer par action">
          <option value="">Toutes les actions</option>
          <option value="reply.">Réponses envoyées</option>
          <option value="draft.">Brouillons</option>
          <option value="auth.">Connexions</option>
          <option value="settings.">Paramètres</option>
          <option value="customer.">Clients (RGPD)</option>
          <option value="gmail.">Gmail</option>
          <option value="shopify.">Shopify</option>
          <option value="ticket.">Tickets</option>
        </select>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Acteur</th>
                <th>Action</th>
                <th>Objet</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((e) => (
                <tr key={e.id}>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>
                    {fmtDateTime(e.at)}
                  </td>
                  <td className="small">{e.actorName ?? ACTORS[e.actorType] ?? e.actorType}</td>
                  <td className="mono">{e.action}</td>
                  <td className="small">
                    {e.entityType} <span className="muted mono">{e.entityId.slice(0, 10)}</span>
                  </td>
                  <td className="mono muted" style={{ maxWidth: 380, wordBreak: "break-all" }}>
                    {e.details ? JSON.stringify(e.details) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {data && data.total > 50 && (
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Précédent
          </button>
          <button className="btn small" disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>
            Suivant
          </button>
        </div>
      )}
    </>
  );
}
