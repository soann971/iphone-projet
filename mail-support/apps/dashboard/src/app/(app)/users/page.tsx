"use client";
import { useState } from "react";
import { StatusBadge } from "@/components/Shell";
import { api } from "@/lib/api";
import { fmtDateTime, ROLE_LABELS } from "@/lib/labels";
import { useApi } from "@/lib/use-api";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
}

export default function UsersPage() {
  const { data, reload } = useApi<User[]>("/api/users");
  const [form, setForm] = useState({ email: "", name: "", role: "AGENT", password: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/users", { method: "POST", json: form });
      setForm({ email: "", name: "", role: "AGENT", password: "" });
      setMsg({ ok: true, text: "Utilisateur créé." });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  async function update(id: string, body: Record<string, unknown>) {
    try {
      await api(`/api/users/${id}`, { method: "PATCH", json: body });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Utilisateurs</h1>
          <p className="muted">Administrateur : tout ; Conseiller : valider et répondre ; Lecture seule : consulter.</p>
        </div>
      </div>
      {msg && (
        <div className={`alert ${msg.ok ? "ok" : "error"}`} style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      )}
      <div className="grid-2">
        <section className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Rôle</th>
                  <th>Dernière connexion</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div>{u.name}</div>
                      <div className="muted small">{u.email}</div>
                    </td>
                    <td>
                      <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value })} style={{ width: 160 }} aria-label={`Rôle de ${u.name}`}>
                        {Object.entries(ROLE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="muted small">{fmtDateTime(u.lastLoginAt)}</td>
                    <td>
                      <button className="btn small" onClick={() => update(u.id, { active: !u.active })}>
                        {u.active ? <StatusBadge label="Actif" tone="good" /> : <StatusBadge label="Désactivé" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <form className="card stack" onSubmit={create}>
          <h2>Nouvel utilisateur</h2>
          <label className="field">
            Nom
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="field">
            Email
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label className="field">
            Rôle
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Mot de passe initial
            <input type="password" minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <span className="hint">12 caractères minimum.</span>
          </label>
          <button className="btn primary">Créer</button>
        </form>
      </div>
    </>
  );
}
