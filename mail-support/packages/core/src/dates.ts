const DAY = 86_400_000;

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY);
}

/** Ajoute des mois calendaires (31/01 + 1 mois = 28 ou 29/02). */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}

/** Fin de journée (23:59:59.999) à Paris, approximée en UTC+1/UTC+2 de façon conservatrice (UTC 23:59). */
export function endOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}

const fmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" });

/** "12 mars 2026" */
export const formatDateFr = (d: Date) => fmt.format(d);
/** "12/03/2026" */
export const formatDateShortFr = (d: Date) => fmtShort.format(d);

/** Montant en euros "1 234,50 €" (espaces normales, compatibles PDF). */
export function formatEuro(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency })
    .format(amount)
    .replace(/[  ]/g, " ");
}
