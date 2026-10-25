import { formatDateFr } from "@ms/core";
import { COLORS, footer, header, newDoc, pdfSafe, toBuffer, type CompanyInfo } from "./common";

export interface ReturnPdfData {
  rmaNumber: string;
  date: Date;
  company: CompanyInfo;
  customer: { name: string | null; email: string };
  orderName: string | null;
  items: { title: string; quantity: number }[];
  deadline: Date | null;
  returnAddress: string;
  shippingCostText: string;
  reason: string | null;
}

export async function renderReturnPdf(d: ReturnPdfData): Promise<Buffer> {
  const doc = newDoc(`Procédure de retour ${d.rmaNumber}`);
  header(doc, d.company, "BON DE RETOUR", `N° ${d.rmaNumber}\nÉmis le ${formatDateFr(d.date)}${d.orderName ? `\nCommande ${d.orderName}` : ""}`);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.text).text("Client");
  doc.font("Helvetica").text(pdfSafe(d.customer.name ?? "")).text(pdfSafe(d.customer.email));
  doc.moveDown();

  doc.font("Helvetica-Bold").text("Article(s) retourné(s)");
  doc.font("Helvetica");
  for (const i of d.items) doc.text(pdfSafe(`- ${i.quantity} x ${i.title}`));
  if (d.reason) doc.moveDown(0.5).fillColor(COLORS.muted).text(pdfSafe(`Motif indiqué : ${d.reason}`)).fillColor(COLORS.text);
  doc.moveDown();

  doc.font("Helvetica-Bold").fontSize(12).fillColor(COLORS.accent).text("Procédure");
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.text);
  const steps = [
    "Emballez soigneusement le ou les articles dans leur emballage d'origine si possible, avec tous les accessoires.",
    "Pour un téléphone : désactivez « Localiser mon iPhone » / déconnectez votre compte, sauvegardez puis réinitialisez l'appareil.",
    `Imprimez ce bon et glissez-le dans le colis (ou notez le numéro ${d.rmaNumber} lisiblement sur le colis).`,
    "Expédiez le colis avec un envoi suivi à l'adresse ci-dessous et conservez la preuve de dépôt.",
    d.deadline
      ? `Votre délai de rétractation court jusqu'au ${formatDateFr(d.deadline)}. Le colis doit ensuite nous être renvoyé dans les 14 jours suivant votre demande.`
      : "Le colis doit nous être renvoyé dans les 14 jours suivant votre demande de rétractation.",
    "Dès réception et vérification, nous vous confirmerons la suite par email.",
  ];
  steps.forEach((s, i) => doc.text(pdfSafe(`${i + 1}. ${s}`), { width: 495, paragraphGap: 4 }));
  doc.moveDown();

  doc.font("Helvetica-Bold").text("Adresse de retour");
  doc.font("Helvetica").text(pdfSafe(d.returnAddress));
  doc.moveDown();
  doc.font("Helvetica-Bold").text("Frais de retour");
  doc.font("Helvetica").fillColor(COLORS.muted).text(pdfSafe(d.shippingCostText), { width: 495 });

  footer(doc, d.company);
  return toBuffer(doc);
}
