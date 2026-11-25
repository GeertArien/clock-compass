import { describe, expect, it } from "vitest";
import { UNKNOWN_VERSION, describeVersion, versionFromEnv } from "./version.js";

describe("the running version (#140)", () => {
  it("reads the build values, and shows the short commit, the build day and the tag", () => {
    const v = versionFromEnv({ GIT_COMMIT: "6F47381A2B3C4D5E6F708192A3B4C5D6E7F80912", BUILD_DATE: "2026-11-24T21:30:34Z", GIT_TAG: "v1.2.0" });
    expect(v).toEqual({ commit: "6f47381a2b3c4d5e6f708192a3b4c5d6e7f80912", date: "2026-11-24T21:30:34.000Z", tag: "v1.2.0" });
    expect(describeVersion(v)).toBe("6f47381 · 24 Nov 2026 (v1.2.0)");
    expect(describeVersion({ ...v, tag: null })).toBe("6f47381 · 24 Nov 2026");
  });

  it("says it is unknown without the values, and never makes one up from malformed ones", () => {
    expect(versionFromEnv({})).toEqual({ commit: null, date: null, tag: null });
    expect(describeVersion(versionFromEnv({}))).toBe(UNKNOWN_VERSION);
    expect(versionFromEnv({ GIT_COMMIT: "not-a-commit", BUILD_DATE: "yesterday", GIT_TAG: "has spaces" })).toEqual({ commit: null, date: null, tag: null });
    expect(describeVersion({ commit: "6f47381", date: null, tag: null })).toBe("6f47381");
  });
});
