import type { Db } from "./client";

/** Incrémente atomiquement un compteur et retourne la nouvelle valeur. */
export async function nextCounter(db: Db, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0]!.value);
}

/** Numéro formaté, ex. DEV-2026-00042 (compteur remis à zéro chaque année). */
export async function nextNumber(db: Db, prefix: string, now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const n = await nextCounter(db, `${prefix}-${year}`);
  return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}
