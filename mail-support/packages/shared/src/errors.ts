/** Erreur définitive : le job ne doit pas être réessayé. */
export class PermanentError extends Error {
  override name = "PermanentError";
}

/** Erreur passagère (réseau, quota) : le job sera réessayé avec backoff. */
export class TransientError extends Error {
  override name = "TransientError";
}
