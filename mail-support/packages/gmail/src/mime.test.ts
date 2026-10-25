import { describe, expect, it } from "vitest";
import { buildMime, encodeHeader, parseGmailMessage } from "./mime";
import { decodePushBody } from "./pubsub";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("parseGmailMessage", () => {
  it("extrait en-têtes, texte, citations et pièces jointes", () => {
    const parsed = parseGmailMessage({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "UNREAD"],
      internalDate: "1761300000000",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "Jeanne Martin <Jeanne.Martin@exemple.fr>" },
          { name: "To", value: "support@boutique.fr" },
          { name: "Subject", value: "Colis non reçu" },
          { name: "Message-ID", value: "<abc@mail.gmail.com>" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Bonjour, je n'ai rien reçu.\n\nLe lun. 20 oct. 2026, Support a écrit :\n> Expédié") } },
              { mimeType: "text/html", body: { data: b64("<p>Bonjour</p>") } },
            ],
          },
          { mimeType: "image/jpeg", filename: "photo.jpg", body: { attachmentId: "att1", size: 12345 } },
        ],
      },
    });
    expect(parsed.fromEmail).toBe("jeanne.martin@exemple.fr");
    expect(parsed.fromName).toBe("Jeanne Martin");
    expect(parsed.rfcMessageId).toBe("<abc@mail.gmail.com>");
    expect(parsed.bodyText).toBe("Bonjour, je n'ai rien reçu.");
    expect(parsed.bodyFull).toContain("Expédié");
    expect(parsed.attachments).toEqual([{ filename: "photo.jpg", mimeType: "image/jpeg", size: 12345, attachmentId: "att1" }]);
  });

  it("se rabat sur le HTML", () => {
    const parsed = parseGmailMessage({
      id: "m2",
      threadId: "t2",
      payload: { mimeType: "text/html", headers: [{ name: "From", value: "a@b.fr" }], body: { data: b64("<div>Bonjour<br>Merci</div>") } },
    });
    expect(parsed.bodyText).toBe("Bonjour\nMerci");
  });
});

describe("buildMime", () => {
  it("construit une réponse dans le fil avec pièce jointe", () => {
    const mime = buildMime(
      {
        from: "support@boutique.fr",
        to: "jeanne@exemple.fr",
        subject: "Re: Colis non reçu – suivi",
        text: "Bonjour,\nVoici le suivi.",
        inReplyTo: "<abc@mail.gmail.com>",
        references: "<prev@mail.gmail.com>",
        autoReplied: true,
        extraHeaders: { "X-MS-Draft-Id": "d1" },
        attachments: [{ filename: "devis.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.4") }],
      },
      "BOUNDARY",
    );
    expect(mime).toContain("In-Reply-To: <abc@mail.gmail.com>");
    expect(mime).toContain("References: <prev@mail.gmail.com> <abc@mail.gmail.com>");
    expect(mime).toContain("Auto-Submitted: auto-replied");
    expect(mime).toContain("X-MS-Draft-Id: d1");
    expect(mime).toContain(`Subject: ${encodeHeader("Re: Colis non reçu – suivi")}`);
    expect(mime).toContain('Content-Type: multipart/mixed; boundary="BOUNDARY"');
    expect(mime).toContain('filename="devis.pdf"');
    expect(mime.trimEnd().endsWith("--BOUNDARY--")).toBe(true);
    const textB64 = mime.split("Content-Transfer-Encoding: base64\r\n\r\n")[1]!.split("\r\n--")[0]!.replace(/\r\n/g, "");
    expect(Buffer.from(textB64, "base64").toString("utf8")).toBe("Bonjour,\r\nVoici le suivi.");
  });
});

describe("decodePushBody", () => {
  it("décode une notification Gmail", () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: "Support@Boutique.fr", historyId: 12345 })).toString("base64");
    expect(decodePushBody({ message: { data, messageId: "p1" } })).toEqual({ emailAddress: "support@boutique.fr", historyId: "12345", pubsubMessageId: "p1" });
  });
  it("rejette un corps invalide", () => {
    expect(() => decodePushBody({})).toThrow();
  });
});
