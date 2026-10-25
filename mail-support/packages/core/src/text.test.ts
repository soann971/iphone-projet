import { describe, expect, it } from "vitest";
import { cleanEmailBody, extractOrderRefs, htmlToText, isAutomatedEmail, parseAddress, parseAddressList, replySubject } from "./text";

describe("cleanEmailBody", () => {
  it("retire la citation Gmail en français", () => {
    const body = "Merci pour votre retour, c'est noté.\n\nLe lun. 20 oct. 2026 à 10:12, Support <support@boutique.fr> a écrit :\n> Bonjour,\n> votre colis est parti.";
    expect(cleanEmailBody(body)).toBe("Merci pour votre retour, c'est noté.");
  });

  it("retire la citation Outlook et la signature mobile", () => {
    const body = "Toujours rien reçu.\n\nEnvoyé de mon iPhone\n\nDe : Support\nEnvoyé : lundi\nObjet : commande";
    expect(cleanEmailBody(body)).toBe("Toujours rien reçu.");
  });

  it("tronque les mails très longs", () => {
    expect(cleanEmailBody("a".repeat(100), 10)).toContain("tronqué");
  });
});

describe("extractOrderRefs", () => {
  it("trouve les numéros de commande", () => {
    expect(extractOrderRefs("Ma commande n° 1052 et la #1060, commande 1077")).toEqual(expect.arrayContaining(["#1052", "#1060", "#1077"]));
  });
  it("ignore les petits nombres", () => {
    expect(extractOrderRefs("J'ai 2 téléphones, #12")).toEqual([]);
  });
});

describe("isAutomatedEmail", () => {
  it("détecte un répondeur", () => {
    expect(isAutomatedEmail({ "Auto-Submitted": "auto-replied" }, "jean@x.fr").automated).toBe(true);
  });
  it("détecte un rebond", () => {
    expect(isAutomatedEmail({}, "mailer-daemon@googlemail.com").automated).toBe(true);
  });
  it("détecte une newsletter", () => {
    expect(isAutomatedEmail({ "List-Unsubscribe": "<mailto:x>" }, "news@x.fr").automated).toBe(true);
  });
  it("laisse passer un client", () => {
    expect(isAutomatedEmail({ "Auto-Submitted": "no" }, "jean@x.fr").automated).toBe(false);
  });
});

describe("adresses et sujets", () => {
  it("parse les en-têtes From", () => {
    expect(parseAddress('"Dupont, Jean" <Jean.Dupont@Exemple.FR>')).toEqual({ email: "jean.dupont@exemple.fr", name: "Dupont, Jean" });
    expect(parseAddress("jean@x.fr")).toEqual({ email: "jean@x.fr", name: null });
    expect(parseAddressList('"A, B" <a@x.fr>, c@y.fr')).toEqual(["a@x.fr", "c@y.fr"]);
  });
  it("préfixe Re: une seule fois", () => {
    expect(replySubject("Ma commande")).toBe("Re: Ma commande");
    expect(replySubject("RE: Ma commande")).toBe("RE: Ma commande");
    expect(replySubject("")).toBe("Re: Votre demande");
  });
  it("convertit le HTML", () => {
    expect(htmlToText("<p>Bonjour&nbsp;!</p><p>Ligne 2<br>Ligne 3</p><style>x{}</style>")).toBe("Bonjour !\nLigne 2\nLigne 3");
  });
});
