export const CATEGORY_LABELS: Record<string, string> = {
  INFO: "Information",
  ORDER: "Commande",
  QUOTE: "Devis",
  WARRANTY: "Garantie",
  RETURN: "Retour",
  AFTER_SALES: "SAV",
  SHIPPING: "Livraison",
  SPAM: "Spam",
};

export const STATUS_LABELS: Record<string, string> = {
  NEW: "Nouveau",
  PROCESSING: "En cours d'analyse",
  PENDING_REVIEW: "À valider",
  AUTO_REPLIED: "Réponse auto",
  REPLIED: "Répondu",
  WAITING_CUSTOMER: "Attente client",
  ESCALATED: "Escaladé",
  CLOSED: "Clos",
  SPAM: "Spam",
  ERROR: "Erreur",
};

/** Ton visuel de chaque statut (classe CSS du badge). */
export const STATUS_TONE: Record<string, string> = {
  NEW: "info",
  PROCESSING: "info",
  PENDING_REVIEW: "warning",
  ESCALATED: "serious",
  ERROR: "critical",
  AUTO_REPLIED: "good",
  REPLIED: "good",
  WAITING_CUSTOMER: "neutral",
  CLOSED: "neutral",
  SPAM: "neutral",
};

export const DRAFT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Brouillon à valider",
  APPROVED: "Validé, envoi en cours",
  SENDING: "Envoi en cours",
  SENT: "Envoyé",
  REJECTED: "Rejeté",
  SUPERSEDED: "Remplacé",
  FAILED: "Échec d'envoi",
};

export const PRIORITY_LABELS: Record<string, string> = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" };

export const ROLE_LABELS: Record<string, string> = { ADMIN: "Administrateur", AGENT: "Conseiller", VIEWER: "Lecture seule" };

const dt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
const d = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
export const fmtDateTime = (s: string | null | undefined) => (s ? dt.format(new Date(s)) : "—");
export const fmtDate = (s: string | null | undefined) => (s ? d.format(new Date(s)) : "—");
export const fmtEuro = (n: number | string | null | undefined) =>
  n === null || n === undefined ? "—" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n));

export function timeAgo(s: string): string {
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}
