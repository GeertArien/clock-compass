import { describe, expect, it, vi } from "vitest";
import { randomId } from "./random";

describe("randomId (#114)", () => {
  it("is 32 hex characters, different each time", () => {
    const a = randomId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomId()).not.toBe(a);
  });

  it("needs only crypto.getRandomValues (what an insecure http origin has)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    try {
      expect(randomId()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
