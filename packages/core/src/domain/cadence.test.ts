import { describe, expect, it } from "vitest";
import { addCadence, addCadenceToDay, deriveStatus, nextDueDate, periodHistory } from "./cadence.js";

const weekly = { unit: "WEEK", value: 1 } as const;

describe("periodHistory", () => {
  it("marks each cadence period hit/miss, oldest first", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const occurrences = [
      new Date("2026-01-30T00:00:00Z"), // current period (last 7 days)
      new Date("2026-01-10T00:00:00Z"), // 3 periods back
    ];
    expect(periodHistory(occurrences, weekly, 4, now)).toEqual([
      true, // Jan 4–11
      false, // Jan 11–18
      false, // Jan 18–25
      true, // Jan 25–Feb 1
    ]);
  });

  it("is all misses with no occurrences", () => {
    expect(periodHistory([], weekly, 3)).toEqual([false, false, false]);
  });
});

describe("nextDueDate", () => {
  it("adds the cadence interval to the last occurrence", () => {
    const last = new Date("2026-01-01T00:00:00Z");
    expect(nextDueDate(last, { unit: "WEEK", value: 2 }).toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
  });
});

describe("deriveStatus", () => {
  it("is OVERDUE when nothing has ever been logged", () => {
    expect(deriveStatus(null, weekly)).toBe("OVERDUE");
  });

  it("is ON_TRACK right after an occurrence", () => {
    const last = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-02T00:00:00Z");
    expect(deriveStatus(last, weekly, now)).toBe("ON_TRACK");
  });

  it("is DUE_SOON near the end of the interval", () => {
    const last = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-07T00:00:00Z"); // 1 day left of 7
    expect(deriveStatus(last, weekly, now)).toBe("DUE_SOON");
  });

  it("is OVERDUE once the interval has elapsed", () => {
    const last = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-09T00:00:00Z");
    expect(deriveStatus(last, weekly, now)).toBe("OVERDUE");
  });
});

describe("addCadence: the calendar, not a fixed number of days (#105)", () => {
  const monthly = { unit: "MONTH", value: 1 } as const;
  const yearly = { unit: "YEAR", value: 1 } as const;

  it.each([
    ["2026-03-15", { unit: "DAY", value: 3 }, 1, "2026-03-18"],
    ["2026-03-15", { unit: "WEEK", value: 2 }, 1, "2026-03-29"],
    ["2026-03-15", monthly, 1, "2026-04-15"],
    ["2026-01-31", monthly, 1, "2026-02-28"],
    ["2028-01-31", monthly, 1, "2028-02-29"],
    ["2026-01-31", monthly, 2, "2026-03-31"],
    ["2026-08-31", monthly, 1, "2026-09-30"],
    ["2026-11-30", { unit: "MONTH", value: 3 }, 1, "2027-02-28"],
    ["2026-12-15", monthly, 1, "2027-01-15"],
    ["2026-11-01", yearly, 1, "2027-11-01"],
    ["2028-02-29", yearly, 1, "2029-02-28"],
    ["2028-02-29", yearly, 4, "2032-02-29"],
    ["2026-11-01", { unit: "YEAR", value: 2 }, 1, "2028-11-01"],
    ["2026-03-31", monthly, -1, "2026-02-28"],
    ["2027-01-15", monthly, -1, "2026-12-15"],
  ] as const)("%s + %j × %i = %s", (day, cadence, n, expected) => {
    expect(addCadenceToDay(day, cadence, n)).toBe(expected);
  });

  it("counted from one anchor, the 31st stays the 31st where a month has one (no drift)", () => {
    const fromAnchor = [1, 2, 3, 4].map((n) => addCadenceToDay("2026-01-31", monthly, n));
    expect(fromAnchor).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("keeps the time of day of an instant", () => {
    expect(addCadence(new Date("2026-01-31T18:45:00.000Z"), monthly).toISOString()).toBe("2026-02-28T18:45:00.000Z");
    expect(addCadence(new Date("2026-03-15T09:00:00.000Z"), monthly).toISOString()).toBe("2026-04-15T09:00:00.000Z");
  });
});

describe("commitments on the calendar (#105 step 1.a)", () => {
  const monthly = { unit: "MONTH", value: 1 } as const;

  it("a monthly commitment logged on 31 January is due on 28 February (it was 2 March with 30-day months)", () => {
    const last = new Date("2026-01-31T10:00:00.000Z");
    expect(nextDueDate(last, monthly).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    // Due soon in the last 20% of its 28 days (5.6 days): from 22 February, 19:36 UTC.
    expect(deriveStatus(last, monthly, new Date("2026-02-22T19:30:00.000Z"))).toBe("ON_TRACK");
    expect(deriveStatus(last, monthly, new Date("2026-02-22T19:40:00.000Z"))).toBe("DUE_SOON");
    expect(deriveStatus(last, monthly, new Date("2026-02-28T10:00:00.000Z"))).toBe("OVERDUE");
  });

  it("a monthly commitment logged on 15 March is due on 15 April (it was 14 April)", () => {
    const last = new Date("2026-03-15T10:00:00.000Z");
    expect(nextDueDate(last, monthly).toISOString()).toBe("2026-04-15T10:00:00.000Z");
    // Due soon in the last 20% of its 31 days (6.2 days): from 9 April, 05:12 UTC; overdue on 15 April.
    expect(deriveStatus(last, monthly, new Date("2026-04-09T05:10:00.000Z"))).toBe("ON_TRACK");
    expect(deriveStatus(last, monthly, new Date("2026-04-09T05:15:00.000Z"))).toBe("DUE_SOON");
    expect(deriveStatus(last, monthly, new Date("2026-04-14T23:00:00.000Z"))).toBe("DUE_SOON");
    expect(deriveStatus(last, monthly, new Date("2026-04-15T10:00:00.000Z"))).toBe("OVERDUE");
  });

  it("a yearly commitment is due a calendar year later", () => {
    const last = new Date("2026-11-01T09:00:00.000Z");
    expect(nextDueDate(last, { unit: "YEAR", value: 1 }).toISOString()).toBe("2027-11-01T09:00:00.000Z");
    // The last 20% of 365 days is 73 days: due soon from 20 August 2027, 09:00 UTC.
    expect(deriveStatus(last, { unit: "YEAR", value: 1 }, new Date("2027-08-20T08:00:00.000Z"))).toBe("ON_TRACK");
    expect(deriveStatus(last, { unit: "YEAR", value: 1 }, new Date("2027-08-20T10:00:00.000Z"))).toBe("DUE_SOON");
  });

  it("counts history in calendar months back from now", () => {
    const now = new Date("2026-05-31T12:00:00.000Z");
    // Periods: (28 Feb, 31 Mar], (31 Mar, 30 Apr], (30 Apr, 31 May].
    const occurrences = [new Date("2026-03-01T00:00:00.000Z"), new Date("2026-05-01T00:00:00.000Z")];
    expect(periodHistory(occurrences, monthly, 3, now)).toEqual([true, false, true]);
  });
});
