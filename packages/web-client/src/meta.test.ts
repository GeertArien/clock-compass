import { describe, expect, it } from "vitest";
import { cadenceLabel, cadenceText, deriveQuadrant, errorMessage, recurrenceLabel } from "./meta";

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
