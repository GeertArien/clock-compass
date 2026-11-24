import { describe, expect, it } from "vitest";
import { addDays, daysBetween, firstSlotAfter, nextOccurrenceDates, nextSlot, type RecurrenceRule } from "./recurrence.js";

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  unit: "WEEK",
  every: 1,
  from: "SCHEDULE",
  anchorDate: "2026-11-02",
  leadDays: null,
  ...over,
});

describe("plain days", () => {
  it("adds and counts days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-11", "2026-11-01")).toBe(21);
    expect(daysBetween("2026-11-01", "2026-10-29")).toBe(-3);
  });
});

describe("firstSlotAfter: a fixed schedule", () => {
  it.each([
    [rule(), "2026-11-02", "2026-11-09"],
    [rule(), "2026-11-08", "2026-11-09"],
    [rule(), "2026-11-24", "2026-11-30"],
    [rule(), "2026-10-01", "2026-11-02"],
    [rule({ every: 2 }), "2026-11-24", "2026-11-30"],
    [rule({ every: 2 }), "2026-12-01", "2026-12-14"],
    [rule({ unit: "DAY", every: 3, anchorDate: "2026-01-01" }), "2026-12-31", "2027-01-02"],
    [rule({ unit: "MONTH", anchorDate: "2026-01-31" }), "2026-02-28", "2026-03-31"],
    [rule({ unit: "MONTH", anchorDate: "2026-01-31" }), "2026-04-01", "2026-04-30"],
    [rule({ unit: "MONTH", every: 3, anchorDate: "2026-01-15" }), "2026-05-01", "2026-07-15"],
    [rule({ unit: "YEAR", anchorDate: "2026-11-01" }), "2026-11-24", "2027-11-01"],
    [rule({ unit: "YEAR", anchorDate: "2026-11-01" }), "2029-06-30", "2029-11-01"],
    [rule({ unit: "YEAR", anchorDate: "2024-02-29" }), "2026-01-01", "2026-02-28"],
    [rule({ unit: "YEAR", anchorDate: "2024-02-29" }), "2027-03-01", "2028-02-29"],
  ])("%j after %s is %s", (r, after, expected) => {
    expect(firstSlotAfter(r, after)).toBe(expected);
  });
});

describe("nextSlot", () => {
  it("on a fixed schedule, completing late gives the first date after today, not a backlog", () => {
    // Weekly from Monday 2 Nov; the 2 Nov occurrence is completed three weeks late, on Tue 24 Nov.
    expect(nextSlot(rule(), "2026-11-02", "2026-11-24", "2026-11-24")).toBe("2026-11-30");
    // Completed on time (or early): the slot after the current one.
    expect(nextSlot(rule(), "2026-11-02", "2026-11-02", "2026-11-02")).toBe("2026-11-09");
    expect(nextSlot(rule(), "2026-11-09", "2026-11-04", "2026-11-04")).toBe("2026-11-16");
    // Yearly, done late on 3 November: next year's 1 November.
    expect(nextSlot(rule({ unit: "YEAR", anchorDate: "2026-11-01" }), "2026-11-01", "2026-11-03", "2026-11-03")).toBe("2027-11-01");
  });

  it("counted from completion: one cadence after the day it was completed", () => {
    const r = rule({ from: "COMPLETION", unit: "MONTH" });
    expect(nextSlot(r, "2026-11-02", "2026-11-26", "2026-11-26")).toBe("2026-12-26");
    expect(nextSlot(r, "2026-01-31", "2026-01-31", "2026-01-31")).toBe("2026-02-28");
  });
});

describe("nextOccurrenceDates", () => {
  const yearly = rule({ unit: "YEAR", anchorDate: "2026-11-01", leadDays: 21 });

  it("repeats the due date, keeps the scheduled day's distance and time, and sets 'show from'", () => {
    const current = { slot: "2026-11-01", due: "2026-11-01", scheduledDay: "2026-10-29", scheduledTime: "09:00", showFrom: "2026-10-11" };
    expect(nextOccurrenceDates(yearly, current, "2027-11-01")).toEqual({
      slot: "2027-11-01",
      due: "2027-11-01",
      scheduledDay: "2027-10-29",
      scheduledTime: "09:00",
      showFrom: "2027-10-11",
    });
  });

  it("a due date moved for this occurrence only does not move the next one", () => {
    const moved = { slot: "2026-11-01", due: "2026-11-05", scheduledDay: null, scheduledTime: null, showFrom: null };
    expect(nextOccurrenceDates(yearly, moved, "2027-11-01")).toMatchObject({ due: "2027-11-01", scheduledDay: null });
  });

  it("a task with only a scheduled day repeats that day", () => {
    const weekly = rule();
    const current = { slot: "2026-11-02", due: null, scheduledDay: "2026-11-02", scheduledTime: "07:30", showFrom: null };
    expect(nextOccurrenceDates(weekly, current, "2026-11-09")).toEqual({
      slot: "2026-11-09",
      due: null,
      scheduledDay: "2026-11-09",
      scheduledTime: "07:30",
      showFrom: null,
    });
  });
});
