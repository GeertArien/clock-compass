import { describe, expect, it } from "vitest";
import { scheduledDayOf, storedScheduledDay } from "./scheduled-day.js";
import { zonedMidnight } from "./zoned.js";
import { envZone, fallbackZone } from "./fallback-zone.js";

describe("a scheduled day is a plain date (#136)", () => {
  it("reads the same day in every zone", () => {
    const thursday = storedScheduledDay("2026-11-26");
    expect(thursday.toISOString()).toBe("2026-11-26T00:00:00.000Z");
    for (const zone of ["UTC", "Europe/Brussels", "America/New_York", "Pacific/Kiritimati"]) {
      expect(scheduledDayOf(thursday, zone), zone).toBe("2026-11-26");
      expect(scheduledDayOf(thursday.toISOString(), zone), zone).toBe("2026-11-26");
    }
    expect(scheduledDayOf(null, "UTC")).toBeNull();
  });

  it("LEGACY (#137): an old value from a Brussels device reads as its day in the reader's zone, both sides of the clock changes", () => {
    for (const day of ["2026-03-28", "2026-03-30", "2026-10-24", "2026-10-26"]) {
      expect(scheduledDayOf(zonedMidnight(day, "Europe/Brussels"), "Europe/Brussels"), day).toBe(day);
    }
  });

  it("LEGACY (#137): an old value from a UTC device reads as its own day, before and after the move", () => {
    // Written at UTC midnight: already the plain form, so the move leaves it and every reader agrees.
    const old = zonedMidnight("2026-11-26", "UTC");
    expect(scheduledDayOf(old, "UTC")).toBe("2026-11-26");
    expect(scheduledDayOf(old, "Europe/Brussels")).toBe("2026-11-26");
    expect(scheduledDayOf(old, "America/New_York")).toBe("2026-11-26");
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
