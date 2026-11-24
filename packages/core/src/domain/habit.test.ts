import { describe, expect, it } from "vitest";
import { countThisWeek, weekStreak } from "./habit.js";

// 2026-06-10 is a Wednesday; its ISO week is Mon Jun 8 – Sun Jun 14.
const today = "2026-06-10";

describe("weekStreak", () => {
  it("counts consecutive past weeks that met the target", () => {
    // Target 2/week; two full past weeks met, week before that missed.
    const marks = [
      "2026-06-01", "2026-06-03", // last week: 2 ✓
      "2026-05-25", "2026-05-28", // week before: 2 ✓
      "2026-05-18", //              three back: 1 ✗
    ];
    expect(weekStreak(marks, 2, today)).toBe(2);
  });

  it("never breaks the streak on an unfinished current week", () => {
    const marks = ["2026-06-01", "2026-06-03"]; // last week met, this week 0
    expect(weekStreak(marks, 2, today)).toBe(1);
  });

  it("extends the streak once the current week's target is met", () => {
    const marks = [
      "2026-06-08", "2026-06-10", // this week: 2 ✓
      "2026-06-01", "2026-06-03", // last week: 2 ✓
    ];
    expect(weekStreak(marks, 2, today)).toBe(2);
  });

  it("is zero when no past week ever met the target", () => {
    expect(weekStreak(["2026-06-09"], 3, today)).toBe(0);
  });

  it("counts weeks across a clock change and a year end alike", () => {
    // Mon 23 and Sun 29 March 2026 (the spring change in Europe), and the
    // ISO week that runs from Mon 28 Dec 2026 into 2027.
    expect(weekStreak(["2026-03-23", "2026-03-29"], 2, "2026-04-01")).toBe(1);
    expect(weekStreak(["2026-12-28", "2027-01-03"], 2, "2027-01-06")).toBe(1);
  });
});

describe("countThisWeek", () => {
  it("counts only marks inside the current ISO week", () => {
    const marks = ["2026-06-08", "2026-06-10", "2026-06-07"]; // Sun 7th = last week
    expect(countThisWeek(marks, today)).toBe(2);
  });

  it("starts the week on Monday, whatever day today is", () => {
    expect(countThisWeek(["2026-06-08"], "2026-06-14")).toBe(1); // Sunday
    expect(countThisWeek(["2026-06-14"], "2026-06-15")).toBe(0); // next Monday
  });
});
