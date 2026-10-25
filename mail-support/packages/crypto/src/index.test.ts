import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { SecretBox, safeEqual } from "./index";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");

describe("SecretBox", () => {
  it("chiffre puis déchiffre", () => {
    const box = new SecretBox(k1);
    const enc = box.encrypt("1//refresh-token-secret");
    expect(enc).not.toContain("refresh");
    expect(box.decrypt(enc)).toBe("1//refresh-token-secret");
  });

  it("produit un chiffré différent à chaque appel (IV aléatoire)", () => {
    const box = new SecretBox(k1);
    expect(box.encrypt("x")).not.toBe(box.encrypt("x"));
  });

  it("détecte une altération", () => {
    const box = new SecretBox(k1);
    const parts = box.encrypt("secret").split(".");
    parts[4] = Buffer.from("autre chose").toString("base64url");
    expect(() => box.decrypt(parts.join("."))).toThrow();
  });

  it("gère la rotation de clé", () => {
    const old = new SecretBox(k1);
    const enc = old.encrypt("secret");
    const rotated = new SecretBox(k2, k1);
    expect(rotated.decrypt(enc)).toBe("secret");
    expect(rotated.needsRotation(enc)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt("secret"))).toBe(false);
    expect(() => new SecretBox(k2).decrypt(enc)).toThrow(/inconnue/);
  });

  it("refuse une clé de mauvaise taille", () => {
    expect(() => new SecretBox(Buffer.from("court").toString("base64"))).toThrow();
  });
});

describe("safeEqual", () => {
  it("compare correctement", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("mots de passe", async () => {
  const { hashPassword, verifyPassword } = await import("./index");
  it("vérifie le bon mot de passe et refuse les autres", () => {
    const h = hashPassword("correct horse battery staple");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(verifyPassword("mauvais", h)).toBe(false);
    expect(verifyPassword("x", "n'importe quoi")).toBe(false);
  });
});
