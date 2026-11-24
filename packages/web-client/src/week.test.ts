import { describe, expect, it } from "vitest";
import { calendarDay, localDay } from "./week";

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
    expect(calendarDay({ scheduledDay: null, dueDate: due, seriesId: "s1" })).toBe("2026-11-30");
    expect(calendarDay({ scheduledDay: null, dueDate: due, seriesId: null })).toBeNull();
    expect(calendarDay({ scheduledDay: null, dueDate: null, seriesId: "s1" })).toBeNull();
  });
});
