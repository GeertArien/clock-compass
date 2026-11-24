import { describe, expect, it } from "vitest";
import { cadenceLabel, cadenceText, deriveQuadrant, errorMessage, plainDayLabel, recurrenceLabel } from "./meta";

describe("meta", () => {
  it("derives the quadrant from importance × urgency", () => {
    expect(deriveQuadrant(true, true)).toBe("Q1");
    expect(deriveQuadrant(true, false)).toBe("Q2");
    expect(deriveQuadrant(false, true)).toBe("Q3");
    expect(deriveQuadrant(false, false)).toBe("Q4");
  });

  it("labels commitment cadences", () => {
    expect(cadenceLabel("WEEK", 1)).toBe("weekly");
    expect(cadenceLabel("MONTH", 1)).toBe("monthly");
    expect(cadenceLabel("WEEK", 2)).toBe("every 2 weeks");
  });

  it("labels habit targets", () => {
    expect(cadenceText(7)).toBe("daily");
    expect(cadenceText(3)).toBe("3×/wk");
  });

  it("turns errors into messages", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("x", "fallback")).toBe("fallback");
  });
});

describe("recurrenceLabel (#105)", () => {
  it("names a rule as people say it", () => {
    expect(recurrenceLabel({ unit: "YEAR", every: 1, from: "SCHEDULE" })).toBe("Repeats every year");
    expect(recurrenceLabel({ unit: "WEEK", every: 2, from: "COMPLETION" })).toBe("Repeats every 2 weeks after completion");
  });
});

describe("plainDayLabel (#105)", () => {
  const now = new Date(2026, 10, 24);
  it("reads a plain date as its calendar day, with the year only when it is not this year", () => {
    expect(plainDayLabel("2026-11-27T00:00:00.000Z", now)).toBe(
      new Date(Date.UTC(2026, 10, 27)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    );
    expect(plainDayLabel("2027-10-11T00:00:00.000Z", now)).toMatch(/2027/);
    expect(plainDayLabel("2026-11-27T00:00:00.000Z", now)).not.toMatch(/2026/);
  });
});
