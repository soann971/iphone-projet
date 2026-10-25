import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Chiffrement symétrique AES-256-GCM des secrets stockés en base
 * (refresh tokens Google, jetons Shopify…).
 *
 * Format : `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url).
 * `keyId` permet la rotation : on déchiffre avec l'ancienne clé, on rechiffre avec la nouvelle.
 */
export class SecretBox {
  private readonly keys = new Map<string, Buffer>();
  private readonly currentId: string;

  constructor(currentKeyB64: string, previousKeyB64?: string) {
    const current = decodeKey(currentKeyB64);
    this.currentId = keyId(current);
    this.keys.set(this.currentId, current);
    if (previousKeyB64) {
      const prev = decodeKey(previousKeyB64);
      this.keys.set(keyId(prev), prev);
    }
  }

  encrypt(plaintext: string): string {
    const key = this.keys.get(this.currentId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", this.currentId, b64(iv), b64(tag), b64(ct)].join(".");
  }

  decrypt(payload: string): string {
    const parts = payload.split(".");
    if (parts.length !== 5 || parts[0] !== "v1") throw new Error("Format de secret chiffré invalide");
    const [, id, iv, tag, ct] = parts as [string, string, string, string, string];
    const key = this.keys.get(id);
    if (!key) throw new Error(`Clé de chiffrement inconnue (${id}) : rotation incomplète ?`);
    const decipher = createDecipheriv("aes-256-gcm", key, unb64(iv));
    decipher.setAuthTag(unb64(tag));
    return Buffer.concat([decipher.update(unb64(ct)), decipher.final()]).toString("utf8");
  }

  /** Vrai si le secret a été chiffré avec une ancienne clé et doit être rechiffré. */
  needsRotation(payload: string): boolean {
    return payload.split(".")[1] !== this.currentId;
  }
}

function decodeKey(b64key: string): Buffer {
  const key = Buffer.from(b64key, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY doit faire 32 octets encodés en base64 (openssl rand -base64 32)");
  return key;
}

const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);
const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

/** Comparaison en temps constant de deux chaînes (signatures HMAC). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function hmacSha256Base64(secret: string, data: string | Buffer): string {
  return createHmac("sha256", secret).update(data).digest("base64");
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hachage de mot de passe (scrypt, sel aléatoire). Format : scrypt$N$r$p$sel$hash */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const hash = scryptSync(password, salt, 64, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, N, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !N || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}
