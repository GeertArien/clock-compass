import { describe, expect, it } from "vitest";
import { momentumFor } from "./momentum";
import type { HabitView } from "@/lib/api";

function habit(overrides: Partial<HabitView>): HabitView {
  return {
    id: "h",
    name: "Habit",
    dimension: null,
    goalId: null,
    goalTitle: null,
    targetPerWeek: 7,
    weekDays: [false, false, false, false, false, false, false],
    doneThisWeek: 0,
    markedToday: false,
    streak: 0,
    ...overrides,
  };
}

describe("momentumFor", () => {
  it("returns null when no habit is linked to the goals", () => {
    const habits = [habit({ id: "h1", goalId: "other" }), habit({ id: "h2", goalId: null })];
    expect(momentumFor(habits, new Set(["g1"]))).toBeNull();
  });

  it("sums kept/target across a goal's habits and takes the best streak", () => {
    const habits = [
      habit({ id: "h1", goalId: "g1", targetPerWeek: 3, doneThisWeek: 2, streak: 4 }),
      habit({ id: "h2", goalId: "g1", targetPerWeek: 7, doneThisWeek: 5, streak: 9 }),
      habit({ id: "h3", goalId: "g2", targetPerWeek: 7, doneThisWeek: 7, streak: 1 }),
    ];
    expect(momentumFor(habits, new Set(["g1"]))).toEqual({
      habits: 2,
      met: 7, // 2 + 5
      target: 10, // 3 + 7
      streak: 9,
    });
  });

  it("caps a habit's contribution at its target (no over-100%)", () => {
    // Marked 5 days but the target is only 3× per week.
    const habits = [habit({ id: "h1", goalId: "g1", targetPerWeek: 3, doneThisWeek: 5 })];
    expect(momentumFor(habits, new Set(["g1"]))).toMatchObject({ met: 3, target: 3 });
  });

  it("aggregates across several goals (a role roll-up)", () => {
    const habits = [
      habit({ id: "h1", goalId: "g1", targetPerWeek: 7, doneThisWeek: 3 }),
      habit({ id: "h2", goalId: "g2", targetPerWeek: 2, doneThisWeek: 2 }),
    ];
    expect(momentumFor(habits, new Set(["g1", "g2"]))).toMatchObject({
      habits: 2,
      met: 5,
      target: 9,
    });
  });
});
