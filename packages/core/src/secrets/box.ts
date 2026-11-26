/**
 * Secrets at rest (issue #103): the stored AI provider keys and the ChatGPT
 * sign-in tokens are encrypted with a secret that lives outside the database,
 * in the `SECRETS_KEY` environment variable (32 random bytes in base64).
 *
 * A stored value is `enc1:<key id>:<nonce>:<ciphertext and tag>`, each part
 * base64url:
 * - AES-256-GCM from Node's `crypto`, a fresh 12-byte nonce for every write;
 * - the key id (8 hex characters, an HMAC of a fixed label) names the secret
 *   without revealing it, so "written with another secret" is told apart
 *   from "damaged", and a later rotation knows which values are old;
 * - bound to its place (table, field and row) as associated data, so a value
 *   copied into another row or field does not open.
 *
 * Owner decisions (#103, 26 November 2026):
 * - without a valid secret, nothing that would store a key or a sign-in is
 *   accepted (`seal` throws); what holds no key keeps working;
 * - a value stored as plain text before this version is never used as a key
 *   and never changed: it reads as "stored before keys were encrypted", and
 *   the owner enters the key again (no data migration);
 * - a wrong or changed secret changes nothing: the value stays as stored and
 *   reads as "encrypted with another secret".
 *
 * Nothing here logs, and no error carries a value or the secret.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/** Whether the server has a usable secret. */
export type SecretsKeyState = "ok" | "missing" | "invalid";

/** Why a stored value cannot be used as a key. */
export type Unreadable =
  /** Stored as plain text by a version before #103: never used, enter the key again. */
  | "before-encryption"
  /** Encrypted with another SECRETS_KEY (a changed or wrong secret). */
  | "other-secret"
  /** Has the marker but does not open with this secret (or is not one this version knows). */
  | "damaged"
  /** Encrypted, but this server has no valid SECRETS_KEY to open it. */
  | "no-secret";

export type Opened = { ok: true; value: string } | { ok: false; why: Unreadable };

const MARKER = "enc1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Thrown by `seal` when the server has no valid secret: the write is refused. */
export class SecretsUnavailableError extends Error {
  constructor(readonly state: Exclude<SecretsKeyState, "ok">) {
    super(
      state === "missing"
        ? "Keys and sign-ins cannot be saved: this server has no SECRETS_KEY. Set it (see the README, Secrets) and restart. Providers without a key can still be saved."
        : "Keys and sign-ins cannot be saved: this server's SECRETS_KEY is not 32 bytes in base64, so it is not used. Correct it (see the README, Secrets) and restart. Providers without a key can still be saved.",
    );
    this.name = "SecretsUnavailableError";
  }
}

export interface SecretsBox {
  readonly state: SecretsKeyState;
  /** The stored form of `value` at `place`; throws SecretsUnavailableError without a valid secret. */
  seal(value: string, place: string): string;
  /**
   * The value back from its stored form at `place`. `bare` says what a value
   * without a known marker is: "plain" for the ChatGPT tokens (stored bare
   * before #103), "unknown" for provider keys (which always had a marker).
   */
  open(stored: string, place: string, bare?: "plain" | "unknown"): Opened;
}

/** Where a provider's key is stored (part of what it is bound to). */
export const providerKeyPlace = (providerId: string): string => `AiProviderConfig.apiKey/${providerId}`;
/** Where a ChatGPT token is stored. */
export const credentialPlace = (field: "accessToken" | "refreshToken", provider: string): string =>
  `ProviderCredential.${field}/${provider}`;

const b64u = (buf: Buffer) => buf.toString("base64url");
const label = (key: Buffer, what: string) => createHmac("sha256", key).update(`clock-compass/${what}`).digest();

/** The secret's 32 bytes, or why there are none. Never logs or returns the text. */
export function parseSecretsKey(raw: string | undefined): { state: "ok"; bytes: Buffer } | { state: "missing" | "invalid" } {
  const text = raw?.trim() ?? "";
  if (!text) return { state: "missing" };
  // 32 bytes are 43 base64 characters and one "=" (or 43 without it, url-safe).
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(text)) return { state: "invalid" };
  const bytes = Buffer.from(text, "base64");
  return bytes.length === 32 ? { state: "ok", bytes } : { state: "invalid" };
}

/** The box for a server's `SECRETS_KEY` (raw, as the environment has it). */
export function secretsBox(raw: string | undefined): SecretsBox {
  const parsed = parseSecretsKey(raw);
  const key = parsed.state === "ok" ? label(parsed.bytes, "secrets/encryption/v1") : null;
  const keyId = parsed.state === "ok" ? label(parsed.bytes, "secrets/key-id/v1").toString("hex").slice(0, 8) : null;

  return {
    state: parsed.state,

    seal(value, place) {
      if (!key || !keyId) throw new SecretsUnavailableError(parsed.state as "missing" | "invalid");
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(place, "utf8"));
      const sealed = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
      return `${MARKER}:${keyId}:${b64u(nonce)}:${b64u(sealed)}`;
    },

    open(stored, place, bare = "unknown") {
      if (!stored.startsWith(`${MARKER}:`)) {
        // `plain:` is how #94 stored provider keys; a bare ChatGPT token is how
        // they were stored before #103. Neither is ever used or changed.
        if (stored.startsWith("plain:") || bare === "plain") return { ok: false, why: "before-encryption" };
        return { ok: false, why: "damaged" };
      }
      if (!key || !keyId) return { ok: false, why: "no-secret" };
      const parts = stored.split(":");
      if (parts.length !== 4) return { ok: false, why: "damaged" };
      const [, id, nonceText, sealedText] = parts as [string, string, string, string];
      if (id !== keyId) return { ok: false, why: "other-secret" };
      try {
        const nonce = Buffer.from(nonceText, "base64url");
        const sealed = Buffer.from(sealedText, "base64url");
        if (nonce.length !== NONCE_BYTES || sealed.length < TAG_BYTES) return { ok: false, why: "damaged" };
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(Buffer.from(place, "utf8"));
        decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
        const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
        return { ok: true, value: plain.toString("utf8") };
      } catch {
        return { ok: false, why: "damaged" };
      }
    },
  };
}

/** What Settings → AI and the test say about an unreadable key, in the owner's words. */
export const UNREADABLE_KEY: Record<Unreadable, string> = {
  "before-encryption": "This key was stored before keys were encrypted, so it is not used: enter it again.",
  "other-secret": "This key was encrypted with another SECRETS_KEY and cannot be read: enter it again.",
  damaged: "This stored key cannot be read: enter it again.",
  "no-secret": "This key cannot be read until the server has a valid SECRETS_KEY.",
};

/** The same for the ChatGPT sign-in. */
export const UNREADABLE_SIGN_IN: Record<Unreadable, string> = {
  "before-encryption": "This ChatGPT sign-in was stored before sign-ins were encrypted, so it is not used: sign in with ChatGPT again.",
  "other-secret": "This ChatGPT sign-in was encrypted with another SECRETS_KEY and cannot be read: sign in with ChatGPT again.",
  damaged: "This ChatGPT sign-in cannot be read: sign in with ChatGPT again.",
  "no-secret": "This ChatGPT sign-in cannot be read until the server has a valid SECRETS_KEY.",
};
