import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomToken, sha256Hex } from "@ms/crypto";

/** Stockage des fichiers générés (PDF) sur disque local / volume Docker. */
export class FileStorage {
  private readonly root: string;
  constructor(dir: string) {
    this.root = resolve(dir);
  }

  async save(buffer: Buffer, filename: string): Promise<{ storagePath: string; size: number; sha256: string }> {
    const now = new Date();
    const rel = join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"), `${randomToken(9)}-${filename.replace(/[^\w.-]/g, "_")}`);
    const abs = this.resolveSafe(rel);
    await mkdir(resolve(abs, ".."), { recursive: true });
    await writeFile(abs, buffer, { mode: 0o600 });
    return { storagePath: rel, size: buffer.length, sha256: sha256Hex(buffer) };
  }

  read(storagePath: string): Promise<Buffer> {
    return readFile(this.resolveSafe(storagePath));
  }

  async remove(storagePath: string) {
    await rm(this.resolveSafe(storagePath), { force: true });
  }

  /** Empêche toute sortie du répertoire de stockage (../). */
  private resolveSafe(rel: string): string {
    const abs = resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new Error("Chemin de stockage invalide");
    return abs;
  }
}
