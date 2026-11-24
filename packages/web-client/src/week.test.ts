import { describe, expect, it } from "vitest";
import { calendarDay, isoWeekMondayPlain, localDay } from "./week";

describe("calendarDay: where a task sits in Clock · Week (#105 step 2)", () => {
  const saturday = new Date(2026, 10, 28); // local midnight, as the app stores a scheduled day

  it("names a local day", () => {
    expect(localDay(saturday)).toBe("2026-11-28");
  });

  it("a scheduled day wins, for every task", () => {
    expect(calendarDay({ scheduledDay: saturday.toISOString(), dueDate: "2026-11-30T00:00:00.000Z" })).toBe("2026-11-28");
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
