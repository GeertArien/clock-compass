import { describe, expect, it } from "vitest";
import { checkStoredDays } from "./stored-days.js";

describe("the start-up check of stored days (#137)", () => {
  it("lets the server start when every stored day is a plain date", async () => {
    expect(await checkStoredDays({ countNotPlain: async () => 0 })).toEqual({ ok: true });
  });

  it("stops it otherwise, saying it changed nothing, and gives the steps in order with the tag", async () => {
    const out = await checkStoredDays({ countNotPlain: async () => 3 });
    if (!("error" in out)) throw new Error("expected a refusal");
    const lines = out.error.split("\n");
    expect(lines[0]).toBe(
      "The server did not start and changed nothing: 3 stored days were written by a version from before 25 November 2026 and are not a plain date, which this version can no longer read.",
    );
    expect(lines[2]).toBe(
      "  1. Update to the version of commit f86705c: the image ghcr.io/geertarien/clock-compass:sha-f86705c, or from a checkout the git tag plain-days (git fetch --tags && git checkout plain-days, then build).",
    );
    expect(lines[3]).toMatch(/^ {2}2\. Start it once and open the app/);
    expect(lines[4]).toBe("  3. Update to this version again.");
  });
});
