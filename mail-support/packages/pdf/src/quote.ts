import { formatDateFr, formatEuro } from "@ms/core";
import { COLORS, footer, header, newDoc, pdfSafe, toBuffer, type CompanyInfo } from "./common";

export interface QuotePdfData {
  number: string;
  date: Date;
  validUntil: Date;
  company: CompanyInfo;
  customer: { name: string | null; email: string };
  lines: { title: string; sku: string | null; quantity: number; unitPriceTtc: number }[];
  vatRate: number;
  terms: string;
  paymentUrl?: string | null;
}

export function quoteTotals(lines: QuotePdfData["lines"], vatRate: number) {
  const totalTtc = round2(lines.reduce((s, l) => s + l.quantity * l.unitPriceTtc, 0));
  const totalHt = round2(totalTtc / (1 + vatRate));
  return { totalTtc, totalHt, totalVat: round2(totalTtc - totalHt) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function renderQuotePdf(d: QuotePdfData): Promise<Buffer> {
  const doc = newDoc(`Devis ${d.number}`);
  header(doc, d.company, "DEVIS", `N° ${d.number}\nDate : ${formatDateFr(d.date)}\nValable jusqu'au ${formatDateFr(d.validUntil)}`);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.text).text("Client");
  doc.font("Helvetica").text(pdfSafe(d.customer.name ?? "")).text(pdfSafe(d.customer.email));
  doc.moveDown(1.5);

  // Tableau
  const cols = { title: 50, qty: 330, unit: 380, total: 465 };
  const top = doc.y;
  doc.rect(50, top - 4, 495, 20).fill(COLORS.fill);
  doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(9);
  doc.text("Désignation", cols.title + 4, top, { width: 270 });
  doc.text("Qté", cols.qty, top, { width: 40, align: "right" });
  doc.text("PU TTC", cols.unit, top, { width: 75, align: "right" });
  doc.text("Total TTC", cols.total, top, { width: 76, align: "right" });
  doc.y = top + 22;
  doc.font("Helvetica").fontSize(9);
  for (const l of d.lines) {
    if (doc.y > doc.page.height - 160) doc.addPage();
    const y = doc.y;
    const label = l.sku ? `${l.title}\nRéf. ${l.sku}` : l.title;
    doc.text(pdfSafe(label), cols.title + 4, y, { width: 270 });
    const h = doc.y - y;
    doc.text(String(l.quantity), cols.qty, y, { width: 40, align: "right" });
    doc.text(formatEuro(l.unitPriceTtc), cols.unit, y, { width: 75, align: "right" });
    doc.text(formatEuro(l.quantity * l.unitPriceTtc), cols.total, y, { width: 76, align: "right" });
    doc.y = y + Math.max(h, 12) + 6;
    doc.moveTo(50, doc.y - 3).lineTo(545, doc.y - 3).strokeColor(COLORS.line).stroke();
  }

  const t = quoteTotals(d.lines, d.vatRate);
  doc.moveDown(0.5);
  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9);
    doc.text(label, 330, y, { width: 130, align: "right" });
    doc.text(value, cols.total, y, { width: 76, align: "right" });
    doc.y = y + (bold ? 18 : 14);
  };
  row("Total HT", formatEuro(t.totalHt));
  row(`TVA (${(d.vatRate * 100).toLocaleString("fr-FR")} %)`, formatEuro(t.totalVat));
  row("Total TTC", formatEuro(t.totalTtc), true);

  doc.moveDown(2);
  doc.x = 50;
  if (d.paymentUrl) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Pour valider ce devis et le régler en ligne :", 50);
    doc.font("Helvetica").fillColor(COLORS.accent).text(d.paymentUrl, { link: d.paymentUrl, underline: true });
    doc.moveDown();
  }
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.text).text("Conditions", 50);
  doc.font("Helvetica").fillColor(COLORS.muted).text(pdfSafe(d.terms), { width: 495 });

  footer(doc, d.company);
  return toBuffer(doc);
}
