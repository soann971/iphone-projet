"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge, useMe } from "@/components/Shell";
import { api } from "@/lib/api";
import { CATEGORY_LABELS, DRAFT_STATUS_LABELS, fmtDate, fmtDateTime, fmtEuro, PRIORITY_LABELS, STATUS_LABELS, STATUS_TONE } from "@/lib/labels";
import { useApi } from "@/lib/use-api";

interface Draft {
  id: string;
  subject: string;
  body: string;
  status: string;
  decision: "AUTO" | "REVIEW";
  confidence: number;
  reviewReasons: string[];
  facts: Record<string, unknown> & { missing?: string[]; flags?: string[]; guardIssues?: { kind: string; value: string }[] };
  documentIds: string[];
  authorType: string;
  approvedBy: { name: string } | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
}

interface Ticket {
  id: string;
  number: number;
  subject: string;
  status: string;
  category: string | null;
  priority: string;
  reviewReasons: string[];
  createdAt: string;
  customer: { id: string; email: string; name: string | null; shopifyCustomerId: string | null };
  order: {
    name: string;
    orderedAt: string;
    totalPrice: string;
    financialStatus: string | null;
    fulfillmentStatus: string | null;
    lineItems: { title: string; quantity: number }[];
    shipments: { id: string; carrier: string | null; trackingNumber: string | null; trackingUrl: string | null; status: string; statusLabel: string | null; deliveredAt: string | null }[];
  } | null;
  messages: {
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    fromEmail: string;
    fromName: string | null;
    subject: string;
    bodyFull: string;
    receivedAt: string;
    isAutomated: boolean;
    attachments: { id: string; filename: string; size: number }[];
  }[];
  analyses: {
    id: string;
    category: string;
    confidence: number;
    sentiment: string;
    summary: string;
    language: string;
    riskFlags: string[];
    injectionSuspected: boolean;
    extracted: Record<string, unknown>;
    model: string;
    createdAt: string;
  }[];
  drafts: Draft[];
  documents: { id: string; kind: string; filename: string }[];
  warrantyClaims: { id: string; productTitle: string; eligible: boolean | null; reason: string; expiresAt: string | null }[];
  returnRequests: { id: string; rmaNumber: string; eligible: boolean | null; eligibilityReason: string; shopifyReturnId: string | null; status: string }[];
  quotes: { id: string; number: string; totalTtc: string; validUntil: string; invoiceUrl: string | null }[];
  history: { id: string; at: string; actorType: string; action: string }[];
  otherTickets: { id: string; number: number; subject: string; status: string }[];
}

const SENTIMENT: Record<string, string> = { positive: "Positif", neutral: "Neutre", negative: "Mécontent", angry: "En colère" };

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { data: t, error, reload } = useApi<Ticket>(`/api/tickets/${id}`);
  const canAct = me?.role !== "VIEWER";

  useEffect(() => {
    // Rafraîchit pendant l'analyse ou l'envoi.
    if (!t) return;
    const busy = t.status === "PROCESSING" || t.status === "NEW" || t.drafts.some((d) => d.status === "APPROVED" || d.status === "SENDING");
    if (!busy) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [t, reload]);

  if (error) return <div className="alert error">{error}</div>;
  if (!t) return <div className="empty">Chargement…</div>;

  const pending = t.drafts.find((d) => d.status === "DRAFT" || d.status === "FAILED");
  const analysis = t.analyses[0];

  async function patch(data: Record<string, unknown>) {
    await api(`/api/tickets/${id}`, { method: "PATCH", json: data });
    await reload();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted small">
            <Link href="/tickets">← Tickets</Link> · Ticket #{t.number} · ouvert le {fmtDateTime(t.createdAt)}
          </div>
          <h1>{t.subject}</h1>
          <div className="row">
            <StatusBadge label={STATUS_LABELS[t.status] ?? t.status} tone={STATUS_TONE[t.status]} />
            {t.category && <StatusBadge label={CATEGORY_LABELS[t.category]!} tone="info" />}
            <StatusBadge label={`Priorité ${PRIORITY_LABELS[t.priority]?.toLowerCase()}`} tone={t.priority === "URGENT" || t.priority === "HIGH" ? "serious" : ""} />
          </div>
        </div>
        {canAct && (
          <div className="row">
            <select value={t.category ?? ""} onChange={(e) => patch({ category: e.target.value })} aria-label="Changer la catégorie" style={{ width: 150 }}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {t.status !== "CLOSED" ? (
              <button className="btn" onClick={() => patch({ status: "CLOSED" })}>
                Clore
              </button>
            ) : (
              <button className="btn" onClick={() => patch({ status: "NEW" })}>
                Rouvrir
              </button>
            )}
          </div>
        )}
      </div>

      {t.reviewReasons.length > 0 && (
        <div className="alert" style={{ marginBottom: 16 }}>
          Validation humaine requise :
          <ul>
            {t.reviewReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          <section className="stack" aria-label="Conversation">
            {t.messages.map((m) => (
              <article key={m.id} className={`msg ${m.direction === "INBOUND" ? "in" : "out"}`}>
                <header>
                  <strong>{m.direction === "INBOUND" ? (m.fromName ?? m.fromEmail) : "Vous"}</strong>
                  <span>
                    {m.isAutomated && <StatusBadge label="Automatique" />} {fmtDateTime(m.receivedAt)}
                  </span>
                </header>
                {/* Le contenu du client est affiché en texte brut (jamais interprété comme HTML). */}
                <div className="body">{m.bodyFull}</div>
                {m.attachments.length > 0 && (
                  <div className="row small" style={{ marginTop: 8 }}>
                    📎
                    {m.attachments.map((a) => (
                      <a key={a.id} href={`/api/attachments/${a.id}`}>
                        {a.filename} ({Math.round(a.size / 1024)} Ko)
                      </a>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>

          {pending && canAct ? (
            <DraftEditor key={pending.id} draft={pending} ticketId={t.id} documents={t.documents} onDone={reload} />
          ) : (
            canAct && <ManualReply ticketId={t.id} onDone={reload} busy={t.status === "PROCESSING"} />
          )}

          <section className="card">
            <h2>Historique des réponses</h2>
            {t.drafts.length === 0 && <p className="muted">Aucune réponse préparée.</p>}
            {t.drafts.map((d) => (
              <details key={d.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
                <summary>
                  {fmtDateTime(d.createdAt)} · {DRAFT_STATUS_LABELS[d.status]} · {d.authorType === "AI" ? "IA" : "Conseiller"} {d.decision === "AUTO" ? "· envoi automatique" : ""}
                  {d.approvedBy ? ` · validé par ${d.approvedBy.name}` : ""}
                </summary>
                {d.error && <div className="alert error">{d.error}</div>}
                <div className="msg" style={{ marginTop: 8 }}>
                  <div className="body">{d.body}</div>
                </div>
              </details>
            ))}
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <h3>Client</h3>
            <dl className="kv">
              <dt>Nom</dt>
              <dd>{t.customer.name ?? "—"}</dd>
              <dt>Email</dt>
              <dd>
                <Link href={`/customers/${t.customer.id}`}>{t.customer.email}</Link>
              </dd>
              <dt>Shopify</dt>
              <dd>{t.customer.shopifyCustomerId ? "Client connu" : "Inconnu"}</dd>
            </dl>
            {t.otherTickets.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="muted small">Autres tickets</div>
                {t.otherTickets.map((o) => (
                  <div key={o.id} className="small">
                    <Link href={`/tickets/${o.id}`}>
                      #{o.number} {o.subject}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          {t.order && (
            <section className="card">
              <h3>Commande {t.order.name}</h3>
              <dl className="kv">
                <dt>Date</dt>
                <dd>{fmtDate(t.order.orderedAt)}</dd>
                <dt>Montant</dt>
                <dd>{fmtEuro(t.order.totalPrice)}</dd>
                <dt>Paiement</dt>
                <dd>{t.order.financialStatus ?? "—"}</dd>
                <dt>Expédition</dt>
                <dd>{t.order.fulfillmentStatus ?? "—"}</dd>
                <dt>Articles</dt>
                <dd>
                  {t.order.lineItems.map((l, i) => (
                    <div key={i}>
                      {l.quantity} × {l.title}
                    </div>
                  ))}
                </dd>
              </dl>
              {t.order.shipments.map((s) => (
                <div key={s.id} className="small" style={{ marginTop: 8 }}>
                  🚚 {s.carrier ?? "Transporteur"} · {s.statusLabel ?? s.status}
                  {s.deliveredAt && ` · livré le ${fmtDate(s.deliveredAt)}`}
                  {s.trackingUrl && (
                    <>
                      {" · "}
                      <a href={s.trackingUrl} target="_blank" rel="noreferrer noopener">
                        {s.trackingNumber ?? "suivi"}
                      </a>
                    </>
                  )}
                </div>
              ))}
            </section>
          )}

          {analysis && (
            <section className="card">
              <h3>Analyse IA</h3>
              <p>{analysis.summary}</p>
              <dl className="kv">
                <dt>Catégorie</dt>
                <dd>{CATEGORY_LABELS[analysis.category]}</dd>
                <dt>Confiance</dt>
                <dd>{Math.round(analysis.confidence * 100)} %</dd>
                <dt>Ton</dt>
                <dd>{SENTIMENT[analysis.sentiment] ?? analysis.sentiment}</dd>
                <dt>Langue</dt>
                <dd>{analysis.language}</dd>
                {analysis.riskFlags.length > 0 && (
                  <>
                    <dt>Signaux</dt>
                    <dd>{analysis.riskFlags.join(", ")}</dd>
                  </>
                )}
              </dl>
              {analysis.injectionSuspected && (
                <div className="alert error" style={{ marginTop: 8 }}>
                  ⚠ Ce mail contient des instructions destinées à l&apos;IA. Elles ont été ignorées ; vérifiez la réponse.
                </div>
              )}
              <details style={{ marginTop: 8 }}>
                <summary className="small">Données extraites</summary>
                <pre className="json">{JSON.stringify(analysis.extracted, null, 2)}</pre>
              </details>
            </section>
          )}

          {(t.warrantyClaims.length > 0 || t.returnRequests.length > 0 || t.quotes.length > 0 || t.documents.length > 0) && (
            <section className="card">
              <h3>Dossiers et documents</h3>
              {t.warrantyClaims.map((w) => (
                <p key={w.id} className="small">
                  🛡 Garantie {w.productTitle} : <StatusBadge label={w.eligible === null ? "Indéterminée" : w.eligible ? "Couverte" : "Refusée"} tone={w.eligible ? "good" : w.eligible === false ? "critical" : "warning"} />
                  <br />
                  <span className="muted">{w.reason}</span>
                </p>
              ))}
              {t.returnRequests.map((r) => (
                <p key={r.id} className="small">
                  ↩ Retour {r.rmaNumber} : <StatusBadge label={r.eligible === null ? "À vérifier" : r.eligible ? "Dans le délai" : "Hors délai"} tone={r.eligible ? "good" : r.eligible === false ? "critical" : "warning"} />
                  <br />
                  <span className="muted">{r.eligibilityReason}</span>
                  {r.shopifyReturnId && <span className="muted"> · créé dans Shopify</span>}
                </p>
              ))}
              {t.quotes.map((q) => (
                <p key={q.id} className="small">
                  🧾 Devis {q.number} : {fmtEuro(q.totalTtc)} TTC, valable jusqu&apos;au {fmtDate(q.validUntil)}
                  {q.invoiceUrl && (
                    <>
                      {" · "}
                      <a href={q.invoiceUrl} target="_blank" rel="noreferrer noopener">
                        lien de paiement
                      </a>
                    </>
                  )}
                </p>
              ))}
              {t.documents.map((d) => (
                <div key={d.id} className="small">
                  📄{" "}
                  <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer">
                    {d.filename}
                  </a>
                </div>
              ))}
            </section>
          )}

          <section className="card">
            <h3>Journal</h3>
            {t.history.length === 0 && <p className="muted small">Aucune action enregistrée.</p>}
            {t.history.slice(0, 15).map((h) => (
              <div key={h.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{h.action}</span>
                <span className="muted">{fmtDateTime(h.at)}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </>
  );
}

function DraftEditor({ draft, ticketId, documents, onDone }: { draft: Draft; ticketId: string; documents: Ticket["documents"]; onDone: () => void }) {
  const [body, setBody] = useState(draft.body);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = body !== draft.body;
  const attached = documents.filter((d) => draft.documentIds.includes(d.id));
  const facts = draft.facts;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      onDone();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const approve = () =>
    run(async () => {
      if (dirty) await api(`/api/drafts/${draft.id}`, { method: "PATCH", json: { body } });
      await api(`/api/drafts/${draft.id}/approve`, { method: "POST" });
    }, "Réponse validée : envoi en cours.");

  return (
    <section className="card stack" aria-label="Réponse proposée">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Réponse proposée</h2>
        <span className="muted small">
          {draft.authorType === "AI" ? `IA · confiance ${Math.round(draft.confidence * 100)} %` : "Rédigée par un conseiller"}
        </span>
      </div>
      {draft.status === "FAILED" && <div className="alert error">Échec d&apos;envoi : {draft.error}</div>}
      {facts.guardIssues && facts.guardIssues.length > 0 && (
        <div className="alert error">
          Données non vérifiées détectées dans la réponse :
          <ul>
            {facts.guardIssues.map((g, i) => (
              <li key={i}>
                {g.kind} : {g.value}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="muted small">Objet : {draft.subject}</div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} aria-label="Corps de la réponse" />
      <div className="muted small">La signature configurée dans les paramètres est ajoutée automatiquement.</div>
      {attached.length > 0 && (
        <div className="small">
          Pièces jointes :{" "}
          {attached.map((d) => (
            <a key={d.id} href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
              📄 {d.filename}
            </a>
          ))}
        </div>
      )}
      <div className="row">
        <button className="btn primary" disabled={busy || !body.trim()} onClick={approve}>
          Valider et envoyer
        </button>
        {dirty && (
          <button className="btn" disabled={busy} onClick={() => run(() => api(`/api/drafts/${draft.id}`, { method: "PATCH", json: { body } }), "Brouillon enregistré.")}>
            Enregistrer
          </button>
        )}
        <button className="btn danger" disabled={busy} onClick={() => run(() => api(`/api/drafts/${draft.id}/reject`, { method: "POST", json: {} }), "Brouillon rejeté.")}>
          Rejeter
        </button>
      </div>
      <details>
        <summary className="small">Régénérer avec une consigne</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{ minHeight: 70 }}
            placeholder="Ex. : proposer un geste commercial de 10 % ; insister sur la procédure de réinitialisation…"
          />
          <button className="btn" disabled={busy} onClick={() => run(() => api(`/api/tickets/${ticketId}/regenerate`, { method: "POST", json: { note } }), "Nouvelle réponse en préparation…")}>
            Régénérer
          </button>
        </div>
      </details>
      <details>
        <summary className="small">Faits vérifiés utilisés par l&apos;IA</summary>
        <pre className="json">{JSON.stringify(facts, null, 2)}</pre>
      </details>
      {msg && <div className="alert ok">{msg}</div>}
    </section>
  );
}

function ManualReply({ ticketId, onDone, busy }: { ticketId: string; onDone: () => void; busy: boolean }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  if (busy) return <div className="card muted">Analyse en cours… la réponse proposée apparaîtra ici.</div>;
  return (
    <section className="card stack">
      <h2 style={{ margin: 0 }}>Écrire une réponse</h2>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Bonjour, …" />
      <div className="row">
        <button
          className="btn"
          disabled={!body.trim() || sending}
          onClick={async () => {
            setSending(true);
            try {
              await api(`/api/tickets/${ticketId}/drafts`, { method: "POST", json: { body } });
              setBody("");
              onDone();
            } finally {
              setSending(false);
            }
          }}
        >
          Créer le brouillon
        </button>
        <button className="btn" onClick={() => api(`/api/tickets/${ticketId}/regenerate`, { method: "POST", json: {} }).then(onDone)}>
          Demander une proposition à l&apos;IA
        </button>
      </div>
    </section>
  );
}
