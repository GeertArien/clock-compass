import { describe, expect, it } from "vitest";
import type { DayMigrationPlan, PrismaDayRepository, StoredDays } from "@clock-compass/core";
import { migrateDays, parseArgs } from "./days-migrate.js";

/** Brussels midnight of a day in winter (UTC+1): 23:00 UTC the day before. */
const brussels = (day: string) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 60 * 60 * 1000);

function fakeRepo(days: StoredDays) {
  const applied: DayMigrationPlan[] = [];
  const repo = { findAll: async () => days, apply: async (plan: DayMigrationPlan) => void applied.push(plan) };
  return { repo: repo as unknown as PrismaDayRepository, applied };
}

const marks = (...days: string[]): StoredDays => ({
  marks: days.map((d, i) => ({ id: `m${i}`, habitId: "h1", day: brussels(d) })),
  intentions: [],
});

describe("days:migrate (#112)", () => {
  it("reads --from and --dry-run, and refuses what is missing or unknown", () => {
    expect(parseArgs(["--from", "Europe/Brussels", "--dry-run"])).toEqual({ from: "Europe/Brussels", dryRun: true });
    expect(parseArgs(["--from", "Europe/Brussels"])).toEqual({ from: "Europe/Brussels", dryRun: false });
    expect(parseArgs([])).toMatch(/--from Europe\/Brussels/);
    expect(parseArgs(["--from", "Europe/Brusels"])).toMatch(/not a time zone/);
    expect(parseArgs(["--from", "UTC", "--force"])).toMatch(/Unknown option: --force/);
  });

  it("a dry run prints the counts and three examples, and changes nothing", async () => {
    const { repo, applied } = fakeRepo(marks("2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"));
    const out: string[] = [];
    expect(await migrateDays(repo, { from: "Europe/Brussels", dryRun: true }, (l) => out.push(l))).toBe(0);
    expect(applied).toEqual([]);
    expect(out).toContain("Habit marks to move: 4. Weekly intentions to move: 0.");
    expect(out.filter((l) => l.includes("->"))).toEqual([
      "  2026-11-19T23:00:00.000Z  ->  2026-11-20T00:00:00.000Z",
      "  2026-11-20T23:00:00.000Z  ->  2026-11-21T00:00:00.000Z",
      "  2026-11-21T23:00:00.000Z  ->  2026-11-22T00:00:00.000Z",
    ]);
    expect(out.at(-1)).toMatch(/Dry run: nothing was changed/);
  });

  it("moves them without --dry-run", async () => {
    const { repo, applied } = fakeRepo(marks("2026-11-24"));
    const out: string[] = [];
    expect(await migrateDays(repo, { from: "Europe/Brussels", dryRun: false }, (l) => out.push(l))).toBe(0);
    expect(applied[0]!.marks.map((m) => m.to.toISOString())).toEqual(["2026-11-24T00:00:00.000Z"]);
    expect(out.at(-1)).toMatch(/Done/);
  });

  it("refuses the wrong zone with exit code 1 and changes nothing", async () => {
    const { repo, applied } = fakeRepo(marks("2026-11-24"));
    const out: string[] = [];
    expect(await migrateDays(repo, { from: "America/New_York", dryRun: false }, (l) => out.push(l))).toBe(1);
    expect(applied).toEqual([]);
    expect(out.join("\n")).toMatch(/Refused: 1 values are not a midnight in America\/New_York/);
  });

  it("says there is nothing to move for data written in UTC", async () => {
    const days: StoredDays = { marks: [{ id: "m1", habitId: "h1", day: new Date("2026-11-24T00:00:00.000Z") }], intentions: [] };
    const { repo, applied } = fakeRepo(days);
    const out: string[] = [];
    expect(await migrateDays(repo, { from: "Europe/Brussels", dryRun: false }, (l) => out.push(l))).toBe(0);
    expect(applied).toEqual([]);
    expect(out.at(-1)).toBe("Nothing to move.");
  });
});
