import { describe, expect, it } from "vitest";
import { scheduledDayOf, storedScheduledDay } from "./scheduled-day.js";
import { envZone, fallbackZone } from "./fallback-zone.js";

describe("a scheduled day is a plain date (#136)", () => {
  it("reads the same day in every zone", () => {
    const thursday = storedScheduledDay("2026-11-26");
    expect(thursday.toISOString()).toBe("2026-11-26T00:00:00.000Z");
    expect(scheduledDayOf(thursday)).toBe("2026-11-26");
    expect(scheduledDayOf(thursday.toISOString())).toBe("2026-11-26");
    expect(scheduledDayOf(null)).toBeNull();
  });
});

describe("the fallback zone (#136)", () => {
  it("is TZ when set, else the reported zone, else UTC", () => {
    expect(fallbackZone("Europe/Brussels", { TZ: "America/New_York" })).toEqual({ zone: "America/New_York", source: "TZ" });
    expect(fallbackZone("Europe/Brussels", {})).toEqual({ zone: "Europe/Brussels", source: "app" });
    expect(fallbackZone(null, {})).toEqual({ zone: "UTC", source: "default" });
  });

  it("counts an empty TZ as not set, and ignores a zone it does not know", () => {
    expect(envZone({ TZ: "" })).toBeNull();
    expect(envZone({ TZ: "  " })).toBeNull();
    expect(fallbackZone("Europe/Brussels", { TZ: "" })).toEqual({ zone: "Europe/Brussels", source: "app" });
    expect(fallbackZone("Mars/Olympus", {})).toEqual({ zone: "UTC", source: "default" });
  });
});
