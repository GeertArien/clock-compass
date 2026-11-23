import { describe, expect, it } from "vitest";
import { isTimeZone, zonedDay, zonedMidnight } from "./zoned.js";

describe("zonedMidnight: a day as midnight in a time zone", () => {
  it.each([
    ["2026-11-23", "Europe/Brussels", "2026-11-22T23:00:00.000Z"],
    ["2026-07-01", "Europe/Brussels", "2026-06-30T22:00:00.000Z"],
    ["2026-11-23", "America/New_York", "2026-11-23T05:00:00.000Z"],
    ["2026-11-23", "UTC", "2026-11-23T00:00:00.000Z"],
    ["2026-11-23", "Asia/Kolkata", "2026-11-22T18:30:00.000Z"],
    ["2026-11-23", "Pacific/Kiritimati", "2026-11-22T10:00:00.000Z"],
    // The days a clock changes: midnight is still on the old offset.
    ["2026-03-29", "Europe/Brussels", "2026-03-28T23:00:00.000Z"],
    ["2026-10-25", "Europe/Brussels", "2026-10-24T22:00:00.000Z"],
    ["2026-03-08", "America/New_York", "2026-03-08T05:00:00.000Z"],
  ])("%s in %s", (day, zone, iso) => {
    expect(zonedMidnight(day, zone).toISOString()).toBe(iso);
    expect(zonedDay(zonedMidnight(day, zone), zone)).toBe(day);
  });

  it("starts a day with no midnight (a DST gap at 00:00) at its first instant", () => {
    // Santiago skipped from 00:00 to 01:00 on 6 September 2026.
    const start = zonedMidnight("2026-09-06", "America/Santiago");
    expect(zonedDay(start, "America/Santiago")).toBe("2026-09-06");
    expect(zonedDay(new Date(start.getTime() - 1), "America/Santiago")).toBe("2026-09-05");
  });

  it("knows real zones only", () => {
    expect(isTimeZone("Europe/Brussels")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone(42)).toBe(false);
  });
});
