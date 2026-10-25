/**
 * Initialisation : crée le premier administrateur et quelques entrées de base de connaissances.
 * Usage : ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm db:seed
 */
import { hashPassword } from "@ms/crypto";
import { getDb, disconnectDb } from "../src/client";

const db = getDb();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 12) throw new Error("ADMIN_PASSWORD doit faire au moins 12 caractères");
    await db.user.upsert({
      where: { email },
      create: { email, name: "Administrateur", role: "ADMIN", passwordHash: hashPassword(password) },
      update: {},
    });
    console.log(`Administrateur prêt : ${email}`);
  } else {
    console.log("ADMIN_EMAIL / ADMIN_PASSWORD non définis : aucun administrateur créé.");
  }

  if ((await db.knowledgeEntry.count()) === 0) {
    await db.knowledgeEntry.createMany({
      data: [
        {
          title: "Délais de livraison",
          content: "À COMPLÉTER : ex. Expédition sous 24 h ouvrées, livraison en 48 à 72 h en France métropolitaine.",
          tags: ["livraison"],
          active: false,
        },
        {
          title: "Moyens de paiement",
          content: "À COMPLÉTER : ex. Carte bancaire, PayPal, paiement en 3 fois.",
          tags: ["paiement"],
          active: false,
        },
        {
          title: "Horaires du service client",
          content: "À COMPLÉTER : ex. Du lundi au vendredi, de 9 h à 18 h.",
          tags: ["contact"],
          active: false,
        },
      ],
    });
    console.log("Base de connaissances initialisée (entrées inactives à compléter dans le dashboard).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
