import PDFDocument from "pdfkit";

export interface CompanyInfo {
  legalName: string;
  address: string;
  siret: string;
  vatNumber: string;
  email: string;
  phone: string;
}

export const COLORS = { text: "#1f2328", muted: "#59636e", accent: "#0b5cad", line: "#d1d9e0", fill: "#f6f8fa" };

/** Polices standard PDF (WinAnsi) : on remplace les caractères non représentables. */
export function pdfSafe(s: string): string {
  return s
    .replace(/[  ]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–|—/g, "-")
    .replace(/…/g, "...");
}

export function newDoc(title: string): PDFKit.PDFDocument {
  return new PDFDocument({ size: "A4", margin: 50, info: { Title: title, Creator: "mail-support" }, bufferPages: true });
}

export function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export function header(doc: PDFKit.PDFDocument, company: CompanyInfo, title: string, subtitle: string) {
  doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(16).text(pdfSafe(company.legalName), 50, 50);
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted).text(pdfSafe(company.address));
  const contact = [company.email, company.phone].filter(Boolean).join("  |  ");
  if (contact) doc.text(pdfSafe(contact));
  doc.font("Helvetica-Bold").fontSize(20).fillColor(COLORS.accent).text(pdfSafe(title), 300, 50, { width: 245, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.text).text(pdfSafe(subtitle), 300, 78, { width: 245, align: "right" });
  doc.moveTo(50, 130).lineTo(545, 130).strokeColor(COLORS.line).stroke();
  doc.y = 145;
  doc.x = 50;
}

/** Pied de page légal sur chaque page. */
export function footer(doc: PDFKit.PDFDocument, company: CompanyInfo) {
  const legal = [company.legalName, company.siret && `SIRET ${company.siret}`, company.vatNumber && `TVA ${company.vatNumber}`].filter(Boolean).join(" - ");
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted);
    doc.text(pdfSafe(legal), 50, doc.page.height - 40, { width: 495, align: "center", lineBreak: false });
    doc.text(`Page ${i + 1}/${range.count}`, 50, doc.page.height - 28, { width: 495, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}
