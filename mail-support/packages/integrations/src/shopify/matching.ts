import type { ShopVariant } from "./types";

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d+)\s*(go|gb)\b/g, "$1go")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const STOP = new Set(["de", "du", "des", "le", "la", "les", "un", "une", "pour", "avec", "et", "reconditionne", "reconditionnes", "neuf"]);

/**
 * Associe un produit demandé par le client à UNE variante du catalogue.
 * Retourne null si aucune ou plusieurs variantes correspondent : on ne devine jamais un prix.
 */
export function matchVariant(requested: string, candidates: ShopVariant[]): ShopVariant | null {
  const tokens = norm(requested)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
  if (!tokens.length) return null;
  const matches = candidates.filter((v) => {
    const hay = norm(`${v.productTitle} ${v.title} ${v.displayName} ${v.sku ?? ""}`);
    const words = new Set(hay.split(" "));
    return tokens.every((t) => words.has(t) || (t.length > 3 && hay.includes(t)));
  });
  if (matches.length === 1) return matches[0]!;
  // Départage : le nom du produit ne doit pas contenir de mot absent de la demande
  // ("iPhone 13" demandé ne doit pas correspondre à "iPhone 13 Pro").
  const asked = new Set(tokens);
  const strict = matches.filter((v) =>
    norm(v.productTitle)
      .split(" ")
      .filter((t) => t && !STOP.has(t))
      .every((t) => asked.has(t)),
  );
  return strict.length === 1 ? strict[0]! : null;
}
