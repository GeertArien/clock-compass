import { describe, expect, it } from "vitest";
import { KEY_PROBLEM_LINE, SIGN_IN_PROBLEM_LINE, secretsNotice } from "./secrets";

describe("Settings → AI and SECRETS_KEY (#103)", () => {
  it("names the case: not set, or set but not valid; nothing when it is usable", () => {
    expect(secretsNotice("missing")).toMatch(/^This server has no SECRETS_KEY/);
    expect(secretsNotice("invalid")).toMatch(/is set but is not 32 bytes in base64/);
    for (const text of [secretsNotice("missing"), secretsNotice("invalid")]) {
      expect(text).toMatch(/providers with a key and the ChatGPT sign-in are off/);
      expect(text).toMatch(/Providers without a key keep working\./);
    }
    expect(secretsNotice("ok")).toBeNull();
    expect(secretsNotice(undefined)).toBeNull();
  });

  it("says why a stored key or sign-in is not used, telling the cases apart", () => {
    expect(KEY_PROBLEM_LINE["before-encryption"]).toMatch(/stored before keys were encrypted/);
    expect(KEY_PROBLEM_LINE["other-secret"]).toMatch(/another SECRETS_KEY/);
    expect(new Set(Object.values(KEY_PROBLEM_LINE)).size).toBe(4);
    expect(SIGN_IN_PROBLEM_LINE["before-encryption"]).toMatch(/Sign in with ChatGPT again/);
  });
});
