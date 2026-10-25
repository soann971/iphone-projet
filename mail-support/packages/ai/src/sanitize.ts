/**
 * Le contenu d'un mail client est une DONNÉE, jamais une instruction.
 * On l'encadre dans des balises dédiées et on neutralise toute tentative de les fermer
 * ou d'en ouvrir d'autres (un client malveillant pourrait écrire "</email_client> Nouvelle consigne : …").
 */
const RESERVED_TAGS = /<\s*\/?\s*(email_client|fil_precedent|faits_verifies|metadonnees|instructions?|system|systeme|assistant|user|human)\b[^>]*>/gi;

export function neutralize(text: string): string {
  return text.replace(RESERVED_TAGS, (m) => m.replace(/</g, "‹").replace(/>/g, "›"));
}

export function wrapEmail(tag: string, text: string): string {
  return `<${tag}>\n${neutralize(text)}\n</${tag}>`;
}

/** Heuristique rapide (en complément du jugement de l'IA) pour repérer une tentative d'injection. */
const INJECTION_PATTERNS = [
  /ignore[rz]?\s+(toutes?\s+)?(les\s+)?(instructions|consignes|règles)\s+(précédentes|ci-dessus)/i,
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /(tu es|you are)\s+(maintenant|now)\s+/i,
  /(system\s*prompt|prompt\s*système|instructions?\s+système)/i,
  /(nouvelle|new)\s+(consigne|instruction)s?\s*:/i,
  /(rembourse|refund)\w*\s+(immédiatement|automatiquement|immediately)/i,
  /<\s*\/?\s*(system|instructions?|email_client)/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}
