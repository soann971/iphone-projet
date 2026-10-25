import { SecretBox } from "@ms/crypto";
import { loadEnv } from "@ms/shared";

let box: SecretBox | undefined;

/** Boîte de chiffrement initialisée depuis ENCRYPTION_KEY. */
export function secretBox(): SecretBox {
  if (!box) {
    const env = loadEnv();
    box = new SecretBox(env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS);
  }
  return box;
}
