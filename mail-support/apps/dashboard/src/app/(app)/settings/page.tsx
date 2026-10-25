"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Settings } from "@ms/shared";
import { StatusBadge, useMe } from "@/components/Shell";
import { api } from "@/lib/api";
import { CATEGORY_LABELS, fmtDateTime } from "@/lib/labels";
import { useApi } from "@/lib/use-api";

interface Integrations {
  gmail: { configured: boolean; pubsub: boolean; accounts: { id: string; email: string; active: boolean; watchExpiresAt: string | null; lastSyncAt: string | null }[] };
  shopify: { configured: boolean; ok?: boolean; shop?: string; error?: string };
  ai: { configured: boolean; model: string };
  carriers: { laposte: boolean; seventeenTrack: boolean };
  queues: { name: string; counts: Record<string, number> }[];
}

const AUTO_CATEGORIES = ["INFO", "ORDER", "SHIPPING", "RETURN", "WARRANTY", "QUOTE", "AFTER_SALES"] as const;

function SettingsInner() {
  const me = useMe();
  const isAdmin = me?.role === "ADMIN";
  const params = useSearchParams();
  const { data: loaded } = useApi<Settings>("/api/settings");
  const { data: integ, reload: reloadInteg } = useApi<Integrations>("/api/integrations");
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const gmailStatus = params.get("gmail");

  useEffect(() => {
    if (loaded) setS(loaded);
  }, [loaded]);
  if (!s) return <div className="empty">Chargement…</div>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setCompany = (k: keyof Settings["company"], v: string) => setS({ ...s, company: { ...s.company, [k]: v } });

  async function save() {
    try {
      const saved = await api<Settings>("/api/settings", { method: "PUT", json: s });
      setS(saved);
      setMsg({ ok: true, text: "Paramètres enregistrés (pris en compte sous 10 secondes)." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Paramètres</h1>
          <p className="muted">Règles d&apos;envoi automatique, contenu des réponses, documents et intégrations.</p>
        </div>
        {isAdmin && (
          <button className="btn primary" onClick={save}>
            Enregistrer
          </button>
        )}
      </div>
      {gmailStatus && (
        <div className={`alert ${gmailStatus === "ok" ? "ok" : "error"}`} style={{ marginBottom: 16 }}>
          {gmailStatus === "ok" ? "Boîte Gmail connectée. Les nouveaux mails seront traités automatiquement." : `Connexion Gmail impossible : ${gmailStatus}`}
        </div>
      )}
      {msg && (
        <div className={`alert ${msg.ok ? "ok" : "error"}`} style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      )}
      {!isAdmin && <div className="alert" style={{ marginBottom: 16 }}>Lecture seule : seuls les administrateurs peuvent modifier les paramètres.</div>}

      <fieldset disabled={!isAdmin} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <section className="card stack">
          <h2>Envoi automatique</h2>
          <label className="check">
            <input type="checkbox" checked={s.autoSendEnabled} onChange={(e) => set("autoSendEnabled", e.target.checked)} />
            <span>
              Activer l&apos;envoi automatique
              <div className="muted small">Désactivé : toutes les réponses attendent votre validation (recommandé pendant les premières semaines).</div>
            </span>
          </label>
          <div className="form-grid">
            <label className="field">
              Seuil de confiance (%)
              <input type="number" min={0} max={100} value={Math.round(s.confidenceThreshold * 100)} onChange={(e) => set("confidenceThreshold", num(e.target.value) / 100)} />
              <span className="hint">En dessous, la réponse attend une validation.</span>
            </label>
            <label className="field">
              Montant nécessitant validation (€ TTC)
              <input type="number" min={0} value={s.amountReviewThreshold} onChange={(e) => set("amountReviewThreshold", num(e.target.value))} />
              <span className="hint">Commande ou devis au-delà : validation obligatoire.</span>
            </label>
            <label className="field">
              Réponses auto max. par fil et par 24 h
              <input type="number" min={0} value={s.maxAutoRepliesPerThreadPerDay} onChange={(e) => set("maxAutoRepliesPerThreadPerDay", num(e.target.value))} />
              <span className="hint">Protection contre les boucles.</span>
            </label>
          </div>
          <div>
            <div className="small" style={{ fontWeight: 500, marginBottom: 6 }}>
              Catégories autorisées à l&apos;envoi automatique
            </div>
            <div className="row">
              {AUTO_CATEGORIES.map((c) => (
                <label key={c} className="check" style={{ marginRight: 12 }}>
                  <input
                    type="checkbox"
                    checked={s.autoSendCategories.includes(c)}
                    onChange={(e) => set("autoSendCategories", e.target.checked ? [...s.autoSendCategories, c] : s.autoSendCategories.filter((x) => x !== c))}
                  />
                  {CATEGORY_LABELS[c]}
                </label>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.reviewUnknownSenders} onChange={(e) => set("reviewUnknownSenders", e.target.checked)} />
            Toujours valider le premier mail d&apos;un expéditeur inconnu de Shopify
          </label>
          <p className="muted small">
            Toujours soumis à validation, quels que soient ces réglages : remboursements, litiges, menaces juridiques, clients mécontents, garanties refusées, retours hors délai,
            tentatives de manipulation de l&apos;IA, données non vérifiées dans la réponse.
          </p>
        </section>

        <section className="card stack">
          <h2>Réponses</h2>
          <div className="form-grid">
            <label className="field">
              Nom de la boutique
              <input value={s.shopName} onChange={(e) => set("shopName", e.target.value)} />
            </label>
            <label className="field">
              Site de la boutique
              <input value={s.shopUrl} onChange={(e) => set("shopUrl", e.target.value)} />
            </label>
            <label className="field">
              Autres domaines autorisés dans les liens
              <input value={s.allowedLinkDomains.join(", ")} onChange={(e) => set("allowedLinkDomains", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
              <span className="hint">Séparés par des virgules. Les transporteurs sont déjà autorisés.</span>
            </label>
          </div>
          <label className="field">
            Signature
            <textarea rows={4} style={{ minHeight: 80 }} value={s.signature} onChange={(e) => set("signature", e.target.value)} />
          </label>
        </section>

        <section className="card stack">
          <h2>Garantie et retours</h2>
          <div className="form-grid">
            <label className="field">
              Garantie par défaut (mois)
              <input type="number" min={0} value={s.defaultWarrantyMonths} onChange={(e) => set("defaultWarrantyMonths", num(e.target.value))} />
              <span className="hint">Remplacée par le métachamp produit Shopify custom.warranty_months s&apos;il existe.</span>
            </label>
            <label className="field">
              Délai de rétractation (jours après livraison)
              <input type="number" min={14} value={s.returnWindowDays} onChange={(e) => set("returnWindowDays", num(e.target.value))} />
              <span className="hint">Minimum légal : 14 jours.</span>
            </label>
          </div>
          <label className="field">
            Adresse de retour
            <textarea rows={3} style={{ minHeight: 70 }} value={s.returnAddress} onChange={(e) => set("returnAddress", e.target.value)} />
          </label>
          <label className="field">
            Frais de retour (texte affiché au client)
            <input value={s.returnShippingCostText} onChange={(e) => set("returnShippingCostText", e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={s.shopifyCreateReturns} onChange={(e) => set("shopifyCreateReturns", e.target.checked)} />
            Créer la demande de retour dans Shopify à l&apos;envoi de la procédure
          </label>
        </section>

        <section className="card stack">
          <h2>Devis et informations légales</h2>
          <div className="form-grid">
            <label className="field">
              Validité des devis (jours)
              <input type="number" min={1} value={s.quoteValidityDays} onChange={(e) => set("quoteValidityDays", num(e.target.value))} />
            </label>
            <label className="field">
              Taux de TVA (%)
              <input type="number" min={0} max={100} step="0.1" value={s.vatRate * 100} onChange={(e) => set("vatRate", num(e.target.value) / 100)} />
            </label>
            <label className="field">
              Raison sociale
              <input value={s.company.legalName} onChange={(e) => setCompany("legalName", e.target.value)} />
            </label>
            <label className="field">
              SIRET
              <input value={s.company.siret} onChange={(e) => setCompany("siret", e.target.value)} />
            </label>
            <label className="field">
              N° de TVA intracommunautaire
              <input value={s.company.vatNumber} onChange={(e) => setCompany("vatNumber", e.target.value)} />
            </label>
            <label className="field">
              Email affiché sur les PDF
              <input value={s.company.email} onChange={(e) => setCompany("email", e.target.value)} />
            </label>
            <label className="field">
              Téléphone
              <input value={s.company.phone} onChange={(e) => setCompany("phone", e.target.value)} />
            </label>
          </div>
          <label className="field">
            Adresse de l&apos;entreprise
            <textarea rows={3} style={{ minHeight: 70 }} value={s.company.address} onChange={(e) => setCompany("address", e.target.value)} />
          </label>
          <label className="field">
            Conditions du devis
            <textarea rows={3} style={{ minHeight: 70 }} value={s.company.quoteTerms} onChange={(e) => setCompany("quoteTerms", e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={s.shopifyCreateDraftOrders} onChange={(e) => set("shopifyCreateDraftOrders", e.target.checked)} />
            Créer une commande provisoire Shopify (lien de paiement) pour chaque devis
          </label>
        </section>

        <section className="card stack">
          <h2>Conservation des données (RGPD)</h2>
          <div className="form-grid">
            <label className="field">
              Données clients (mois après le dernier contact)
              <input type="number" min={0} value={s.retentionMonths} onChange={(e) => set("retentionMonths", num(e.target.value))} />
              <span className="hint">0 = conservation illimitée. Purge automatique chaque nuit.</span>
            </label>
            <label className="field">
              Journal d&apos;audit (mois)
              <input type="number" min={1} value={s.auditRetentionMonths} onChange={(e) => set("auditRetentionMonths", num(e.target.value))} />
            </label>
          </div>
        </section>
      </fieldset>

      {integ && (
        <section className="card stack" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Intégrations</h2>
            <button className="btn small" onClick={reloadInteg}>
              Actualiser
            </button>
          </div>
          <div className="stack">
            <div>
              <strong>Gmail</strong>{" "}
              {integ.gmail.accounts.filter((a) => a.active).length ? <StatusBadge label="Connecté" tone="good" /> : <StatusBadge label="Non connecté" tone="warning" />}{" "}
              {!integ.gmail.pubsub && <StatusBadge label="Pub/Sub non configuré : relève toutes les 10 min" tone="warning" />}
              {integ.gmail.accounts.map((a) => (
                <div key={a.id} className="small muted">
                  {a.email} · {a.active ? "actif" : "déconnecté"} · notifications jusqu&apos;au {fmtDateTime(a.watchExpiresAt)} · dernière synchro {fmtDateTime(a.lastSyncAt)}
                  {isAdmin && a.active && (
                    <button className="btn small danger" style={{ marginLeft: 8 }} onClick={() => api(`/api/gmail/${a.id}`, { method: "DELETE" }).then(reloadInteg)}>
                      Déconnecter
                    </button>
                  )}
                </div>
              ))}
              {isAdmin && (
                <div className="row" style={{ marginTop: 6 }}>
                  <a className="btn small" href="/oauth/google/start">
                    {integ.gmail.accounts.some((a) => a.active) ? "Reconnecter une boîte Gmail" : "Connecter la boîte Gmail"}
                  </a>
                  <button className="btn small" onClick={() => api("/api/gmail/sync", { method: "POST" }).then(() => setMsg({ ok: true, text: "Synchronisation demandée." }))}>
                    Synchroniser maintenant
                  </button>
                </div>
              )}
              {!integ.gmail.configured && <div className="alert error small">GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET non configurés (voir docs/google-cloud.md).</div>}
            </div>
            <div>
              <strong>Shopify</strong>{" "}
              {!integ.shopify.configured ? (
                <StatusBadge label="Non configuré" tone="warning" />
              ) : integ.shopify.ok ? (
                <StatusBadge label={`Connecté : ${integ.shopify.shop}`} tone="good" />
              ) : (
                <StatusBadge label={`Erreur : ${integ.shopify.error}`} tone="critical" />
              )}
            </div>
            <div>
              <strong>IA (Claude)</strong> {integ.ai.configured ? <StatusBadge label={integ.ai.model} tone="good" /> : <StatusBadge label="Clé API manquante" tone="critical" />}
            </div>
            <div>
              <strong>Transporteurs</strong> <StatusBadge label={`La Poste ${integ.carriers.laposte ? "✓" : "—"}`} tone={integ.carriers.laposte ? "good" : ""} />{" "}
              <StatusBadge label={`17TRACK ${integ.carriers.seventeenTrack ? "✓" : "—"}`} tone={integ.carriers.seventeenTrack ? "good" : ""} />
              <div className="muted small">Sans clé, le statut provient uniquement de Shopify.</div>
            </div>
          </div>
          <div>
            <h3>Files de traitement</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>En attente</th>
                    <th>En cours</th>
                    <th>Différés</th>
                    <th>Échecs</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {integ.queues.map((q) => (
                    <tr key={q.name}>
                      <td className="mono">{q.name}</td>
                      <td>{q.counts.waiting ?? 0}</td>
                      <td>{q.counts.active ?? 0}</td>
                      <td>{q.counts.delayed ?? 0}</td>
                      <td style={{ color: q.counts.failed ? "var(--critical)" : undefined }}>{q.counts.failed ?? 0}</td>
                      <td>
                        {isAdmin && (q.counts.failed ?? 0) > 0 && (
                          <button className="btn small" onClick={() => api(`/api/queues/${q.name}/retry`, { method: "POST" }).then(reloadInteg)}>
                            Relancer les échecs
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
