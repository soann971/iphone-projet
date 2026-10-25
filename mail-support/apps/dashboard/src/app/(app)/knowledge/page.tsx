"use client";
import { useState } from "react";
import { StatusBadge, useMe } from "@/components/Shell";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface Entry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  active: boolean;
}

const EMPTY = { title: "", content: "", tags: [] as string[], active: true };

export default function KnowledgePage() {
  const me = useMe();
  const canEdit = me?.role !== "VIEWER";
  const { data, reload } = useApi<Entry[]>("/api/knowledge");
  const [edit, setEdit] = useState<(typeof EMPTY & { id?: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!edit) return;
    try {
      const { id, ...body } = edit;
      await api(id ? `/api/knowledge/${id}` : "/api/knowledge", { method: id ? "PUT" : "POST", json: body });
      setEdit(null);
      setErr(null);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Base de connaissances</h1>
          <p className="muted">
            Les seules informations générales que l&apos;IA a le droit d&apos;utiliser (délais, paiement, horaires…). Sans entrée pertinente, elle transmet à un conseiller au lieu
            d&apos;inventer.
          </p>
        </div>
        {canEdit && (
          <button className="btn primary" onClick={() => setEdit({ ...EMPTY })}>
            Ajouter une entrée
          </button>
        )}
      </div>
      {edit && (
        <section className="card stack" style={{ marginBottom: 16 }}>
          <label className="field">
            Titre
            <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          </label>
          <label className="field">
            Contenu (exact et à jour : il sera repris tel quel)
            <textarea value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
            Active (utilisable par l&apos;IA)
          </label>
          {err && <div className="alert error">{err}</div>}
          <div className="row">
            <button className="btn primary" onClick={save}>
              Enregistrer
            </button>
            <button className="btn" onClick={() => setEdit(null)}>
              Annuler
            </button>
          </div>
        </section>
      )}
      <div className="stack">
        {data?.map((k) => (
          <section key={k.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{k.title}</h2>
              <div className="row">
                {!k.active && <StatusBadge label="Inactive" tone="warning" />}
                {canEdit && (
                  <>
                    <button className="btn small" onClick={() => setEdit({ ...k })}>
                      Modifier
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() => {
                        if (confirm(`Supprimer « ${k.title} » ?`)) void api(`/api/knowledge/${k.id}`, { method: "DELETE" }).then(reload);
                      }}
                    >
                      Supprimer
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
              {k.content}
            </p>
          </section>
        ))}
        {data?.length === 0 && <div className="empty">Aucune entrée.</div>}
      </div>
    </>
  );
}
