import { describe, expect, it } from "vitest";
import { calendarDay, isoWeekMondayPlain, localDay, scheduledDayOf, storedDay } from "./week";

describe("calendarDay: where a task sits in Clock · Week (#105 step 2)", () => {
  const saturday = new Date(2026, 10, 28); // a local midnight

  it("names a local day", () => {
    expect(localDay(saturday)).toBe("2026-11-28");
  });

  it("a scheduled day wins, for every task", () => {
    expect(calendarDay({ scheduledDay: "2026-11-28T00:00:00.000Z", dueDate: "2026-11-30T00:00:00.000Z" })).toBe("2026-11-28");
  });

  it("a scheduled day is a plain date: its first 10 characters, whatever the device's zone (#136)", () => {
    expect(scheduledDayOf({ scheduledDay: "2026-11-26T00:00:00.000Z" })).toBe("2026-11-26");
    expect(scheduledDayOf({ scheduledDay: "2026-11-26" })).toBe("2026-11-26");
    expect(scheduledDayOf({ scheduledDay: null })).toBeNull();
    expect(storedDay("2026-11-26")).toBe("2026-11-26T00:00:00.000Z");
  });

  it("a recurring task with only a due date sits on its due date; another task does not", () => {
    const due = "2026-11-30T00:00:00.000Z";
    expect(calendarDay({ scheduledDay: null, dueDate: due, recurrence: { active: true } })).toBe("2026-11-30");
    expect(calendarDay({ scheduledDay: null, dueDate: due, recurrence: null })).toBeNull();
    expect(calendarDay({ scheduledDay: null, dueDate: null, recurrence: { active: true } })).toBeNull();
  });

  it("a task whose series stopped repeating is a normal task again: off the calendar", () => {
    expect(calendarDay({ scheduledDay: null, dueDate: "2026-11-30T00:00:00.000Z", recurrence: { active: false } })).toBeNull();
  });
});

describe("isoWeekMondayPlain (#112)", () => {
  it("names this week's Monday as a plain date at UTC midnight", () => {
    // Wednesday 25 November 2026 at noon on this device.
    expect(isoWeekMondayPlain(new Date(2026, 10, 25, 12))).toBe("2026-11-23T00:00:00.000Z");
    // Sunday 29 November late evening still belongs to that week.
    expect(isoWeekMondayPlain(new Date(2026, 10, 29, 23, 30))).toBe("2026-11-23T00:00:00.000Z");
  });
});
