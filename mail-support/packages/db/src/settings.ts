import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from "@ms/shared";
import type { Db } from "./client";

/** Lit tous les paramètres (valeurs par défaut pour les clés absentes ou invalides). */
export async function loadSettings(db: Db): Promise<Settings> {
  const rows = await db.setting.findMany();
  const raw: Record<string, unknown> = {};
  for (const r of rows) raw[r.key] = r.value;
  const parsed = SettingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Une clé invalide ne doit pas bloquer le service : on ignore les clés fautives.
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(raw)) {
    const single = SettingsSchema.partial().safeParse({ [k]: v });
    if (single.success) merged[k] = v;
  }
  return SettingsSchema.parse(merged);
}

/** Met à jour un sous-ensemble de paramètres (validés). Retourne les paramètres complets. */
export async function saveSettings(db: Db, patch: Partial<Settings>, userId?: string): Promise<Settings> {
  const valid = SettingsSchema.partial().parse(patch);
  await db.$transaction(
    Object.entries(valid).map(([key, value]) =>
      db.setting.upsert({
        where: { key },
        create: { key, value: value as never, updatedById: userId ?? null },
        update: { value: value as never, updatedById: userId ?? null },
      }),
    ),
  );
  return loadSettings(db);
}
