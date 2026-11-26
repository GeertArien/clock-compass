import { describe, expect, it } from "vitest";
import { SecretsUnavailableError, credentialPlace, parseSecretsKey, providerKeyPlace, secretsBox } from "./box.js";
import { secretsReport } from "./report.js";

/** A sentinel secret (32 bytes) and a sentinel key: neither may ever appear in output. */
const SECRET = Buffer.from("SENTINEL-SECRET-0123456789abcdef").toString("base64");
const KEY = "sk-SENTINEL-KEY-0123456789abcdef";
const box = secretsBox(SECRET);
const place = providerKeyPlace("p1");

describe("SECRETS_KEY (#103)", () => {
  it("is 32 bytes in base64 (as openssl rand -base64 32 prints it); anything else is missing or invalid", () => {
    expect(parseSecretsKey(SECRET).state).toBe("ok");
    expect(parseSecretsKey(Buffer.alloc(32, 1).toString("base64url")).state).toBe("ok");
    expect(parseSecretsKey(` ${SECRET}\n`).state).toBe("ok");
    expect(parseSecretsKey(undefined).state).toBe("missing");
    expect(parseSecretsKey("   ").state).toBe("missing");
    expect(parseSecretsKey("hunter2").state).toBe("invalid");
    expect(parseSecretsKey(Buffer.alloc(31).toString("base64")).state).toBe("invalid");
    expect(parseSecretsKey(Buffer.alloc(33).toString("base64")).state).toBe("invalid");
  });
});

describe("the secrets box (#103)", () => {
  it("seals as enc1 with a key id, a fresh nonce every time, and opens it back at the same place", () => {
    const a = box.seal(KEY, place);
    const b = box.seal(KEY, place);
    expect(a).toMatch(/^enc1:[0-9a-f]{8}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("SENTINEL");
    expect(box.open(a, place)).toEqual({ ok: true, value: KEY });
  });

  it("does not open at another place: another row or another field", () => {
    const sealed = box.seal(KEY, place);
    expect(box.open(sealed, providerKeyPlace("p2"))).toEqual({ ok: false, why: "damaged" });
    expect(box.open(sealed, credentialPlace("accessToken", "openai-codex"))).toEqual({ ok: false, why: "damaged" });
  });

  it("tells another secret from a damaged value, and from no secret at all", () => {
    const sealed = box.seal(KEY, place);
    expect(secretsBox(Buffer.alloc(32, 3).toString("base64")).open(sealed, place)).toEqual({ ok: false, why: "other-secret" });
    expect(secretsBox(undefined).open(sealed, place)).toEqual({ ok: false, why: "no-secret" });
    expect(secretsBox("bad").open(sealed, place)).toEqual({ ok: false, why: "no-secret" });
    const [m, id, nonce, data] = sealed.split(":") as [string, string, string, string];
    const flipped = `${m}:${id}:${nonce}:${data.slice(0, -2)}${data.endsWith("AA") ? "BB" : "AA"}`;
    expect(box.open(flipped, place)).toEqual({ ok: false, why: "damaged" });
    expect(box.open(`${m}:${id}:${nonce}`, place)).toEqual({ ok: false, why: "damaged" });
  });

  it("reads a value stored as plain text before #103 as such, never as a key", () => {
    expect(box.open(`plain:${KEY}`, place)).toEqual({ ok: false, why: "before-encryption" });
    // A ChatGPT token was stored bare.
    expect(box.open("eyJhbGciOi.bare.token", credentialPlace("accessToken", "openai-codex"), "plain")).toEqual({ ok: false, why: "before-encryption" });
    // A provider key with a marker this version does not know.
    expect(box.open("v9:something", place)).toEqual({ ok: false, why: "damaged" });
  });

  it("refuses to seal without a valid secret, saying which case it is and nothing else", () => {
    expect(() => secretsBox(undefined).seal(KEY, place)).toThrow(SecretsUnavailableError);
    expect(() => secretsBox(undefined).seal(KEY, place)).toThrow(/has no SECRETS_KEY/);
    expect(() => secretsBox("SENTINEL-not-a-key").seal(KEY, place)).toThrow(/is not 32 bytes in base64/);
    try {
      secretsBox("SENTINEL-not-a-key").seal(KEY, place);
    } catch (err) {
      expect((err as Error).message).not.toContain("SENTINEL");
    }
  });
});

describe("the start-up report (#103)", () => {
  const provider = (id: string) => ({ id, name: id, kind: "openai-compatible", baseUrl: null, keySet: true, keyHint: null, models: [], createdAt: new Date(), updatedAt: new Date() });
  const repos = (keys: Record<string, string>, signIn: { accessToken: string; refreshToken: string } | null) => ({
    providers: { listProviders: async () => Object.keys(keys).map(provider), secretFor: async (id: string) => keys[id] ?? null },
    credentials: { get: async () => (signIn ? ({ provider: "openai-codex", ...signIn } as never) : null) },
  });

  it("says nothing when every stored key opens", async () => {
    const r = repos({ p1: box.seal(KEY, place) }, null);
    expect(await secretsReport(box, r.providers, r.credentials)).toEqual([]);
  });

  it("names a missing or invalid secret, counts what waits, and never shows a value", async () => {
    const r = repos({ p1: `plain:${KEY}`, p2: `plain:${KEY}`, p3: box.seal(KEY, providerKeyPlace("p3")) }, { accessToken: "SENTINEL-ACCESS", refreshToken: "SENTINEL-REFRESH" });
    const missing = await secretsReport(secretsBox(undefined), r.providers, r.credentials);
    expect(missing).toEqual([
      "SECRETS_KEY is not set: AI providers with a key and the ChatGPT sign-in are off, and no key or sign-in can be saved until it is set (see the README, Secrets). Providers without a key keep working.",
      "2 provider keys and the ChatGPT sign-in were stored before keys were encrypted: not used and not changed. Enter the keys again and sign in to ChatGPT again in Settings → AI.",
      "1 provider key cannot be read until SECRETS_KEY is set correctly. Nothing was changed.",
    ]);
    const invalid = await secretsReport(secretsBox("SENTINEL-bad"), r.providers, r.credentials);
    expect(invalid[0]).toMatch(/^SECRETS_KEY is set but is not 32 bytes in base64, so it is not used:/);
    for (const line of [...missing, ...invalid]) expect(line).not.toMatch(/SENTINEL|sk-/);
  });

  it("counts keys encrypted with another secret", async () => {
    const other = secretsBox(Buffer.alloc(32, 5).toString("base64"));
    const r = repos({ p1: other.seal(KEY, place) }, null);
    // Only what applies is asked for.
    const onlySignIn = repos({}, { accessToken: "bare", refreshToken: "bare" });
    expect(await secretsReport(box, onlySignIn.providers, onlySignIn.credentials)).toEqual([
      "The ChatGPT sign-in was stored before keys were encrypted: not used and not changed. Sign in to ChatGPT again in Settings → AI.",
    ]);
    expect(await secretsReport(box, r.providers, r.credentials)).toEqual([
      "1 provider key was encrypted with another SECRETS_KEY and cannot be read: enter it again in Settings → AI. Nothing was changed.",
    ]);
  });
});
