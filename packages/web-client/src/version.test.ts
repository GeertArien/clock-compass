import { describe, expect, it } from "vitest";
import { UNKNOWN_VERSION, describeVersion, versionNote, versionOf } from "./version";

const server = versionOf({ commit: "f86705cb1829d88e42110a533cd3da9fda490aed", date: "2026-11-25T06:52:24Z", tag: null });

describe("the versions in Settings (#140)", () => {
  it("shows the short commit and the build day, or says it is unknown", () => {
    expect(describeVersion(server)).toBe("f86705c · 25 Nov 2026");
    expect(describeVersion(versionOf({ commit: "f86705c", date: null, tag: "v1.0.0" }))).toBe("f86705c (v1.0.0)");
    expect(describeVersion(versionOf(undefined))).toBe(UNKNOWN_VERSION);
    expect(describeVersion(versionOf({ commit: "made-up" }))).toBe(UNKNOWN_VERSION);
  });

  it("says when this device's app is behind the server, and nothing when they match or one is unknown", () => {
    const older = versionOf({ commit: "db3eac6ac612d5275e57e8b3d12630bbc07ce5c9", date: "2026-11-24T21:30:34Z" });
    expect(versionNote(older, server)).toBe("This device has an older version of the app; reload to update.");
    expect(versionNote(server, older)).toMatch(/different versions/);
    expect(versionNote(server, server)).toBeNull();
    expect(versionNote(versionOf(null), server)).toBeNull();
  });
});
