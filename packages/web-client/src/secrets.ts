/**
 * What Settings → AI says about the server's SECRETS_KEY and about stored
 * keys that are not used (#103). Words only, never a value: the server never
 * sends the secret or a key, only which case it is.
 */
import type { KeyProblem, SecretsState } from "./api";

/** The notice at the top of Settings → AI; null when the server has a usable secret. */
export function secretsNotice(state: SecretsState | undefined): string | null {
  if (state === "missing") {
    return "This server has no SECRETS_KEY, the secret that stored keys are encrypted with. Until it is set, providers with a key and the ChatGPT sign-in are off, and no key can be saved. Providers without a key keep working.";
  }
  if (state === "invalid") {
    return "This server's SECRETS_KEY is set but is not 32 bytes in base64, so it is not used. Until it is corrected, providers with a key and the ChatGPT sign-in are off, and no key can be saved. Providers without a key keep working.";
  }
  return null;
}

/** Why a provider's stored key is not used, in a short line. */
export const KEY_PROBLEM_LINE: Record<KeyProblem, string> = {
  "before-encryption": "Key stored before keys were encrypted: not used. Enter it again.",
  "other-secret": "Key encrypted with another SECRETS_KEY: not used. Enter it again.",
  damaged: "The stored key cannot be read: enter it again.",
  "no-secret": "Key kept; used once the server has a valid SECRETS_KEY.",
};

/** The same for the ChatGPT sign-in. */
export const SIGN_IN_PROBLEM_LINE: Record<KeyProblem, string> = {
  "before-encryption": "Signed in before sign-ins were encrypted: not used. Sign in with ChatGPT again.",
  "other-secret": "Sign-in encrypted with another SECRETS_KEY: not used. Sign in with ChatGPT again.",
  damaged: "The stored sign-in cannot be read: sign in with ChatGPT again.",
  "no-secret": "Sign-in kept; used once the server has a valid SECRETS_KEY.",
};
