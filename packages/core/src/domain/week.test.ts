import { describe, expect, it } from "vitest";
import { addDays, dayAtUtc, inWeek, isoWeekStart, isoWeekday, plainDayOf, todayOf } from "./week.js";

describe("plain days (#112)", () => {
  it("stores a day at UTC midnight and reads it back unchanged", () => {
    expect(dayAtUtc("2026-11-24").toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(plainDayOf(dayAtUtc("2026-03-29"))).toBe("2026-03-29");
  });

  it("adds days across month ends, year ends and clock changes", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Monday of an ISO week", () => {
    expect(isoWeekStart("2026-11-23")).toBe("2026-11-23"); // Monday
    expect(isoWeekStart("2026-11-29")).toBe("2026-11-23"); // Sunday
    expect(isoWeekStart("2027-01-01")).toBe("2026-12-28"); // a week across the year end
    expect(isoWeekday("2026-11-29")).toBe(7);
    expect(inWeek("2026-11-29", "2026-11-23")).toBe(true);
    expect(inWeek("2026-11-30", "2026-11-23")).toBe(false);
  });

  it("reads today in the clock's zone, not the process's", () => {
    const now = new Date("2026-11-23T23:30:00Z");
    expect(todayOf({ now, timeZone: "Europe/Brussels" })).toBe("2026-11-24");
    expect(todayOf({ now, timeZone: "America/New_York" })).toBe("2026-11-23");
    expect(todayOf({ now, timeZone: "UTC" })).toBe("2026-11-23");
  });
});
