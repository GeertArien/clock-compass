import { describe, expect, it } from "vitest";
import type { DayMigrationPlan, StoredDays } from "@clock-compass/core";
import { migrateDays, parseArgs } from "./days-migrate.js";

/** Brussels midnight of a day in winter (UTC+1): 23:00 UTC the day before. */
const brussels = (day: string) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 60 * 60 * 1000);
/** New York midnight of a day in winter (UTC-5): 05:00 UTC that day. */
const newYork = (day: string) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 5 * 60 * 60 * 1000);

function fakeRepo(days: StoredDays) {
  const applied: DayMigrationPlan[] = [];
  const repo = { findAll: async () => days, apply: async (plan: DayMigrationPlan) => void applied.push(plan) };
  return { repo, applied };
}

const marks = (...days: string[]): StoredDays => ({
  marks: days.map((d, i) => ({ id: `m${i}`, habitId: "h1", day: brussels(d) })),
  intentions: [],
});

describe("days:migrate (#112, #136)", () => {
  it("reads --from (once or more) and --dry-run, and refuses what is missing or unknown", () => {
    expect(parseArgs(["--from", "Europe/Brussels", "--dry-run"])).toEqual({ from: ["Europe/Brussels"], dryRun: true });
    expect(parseArgs(["--from", "Europe/Brussels"])).toEqual({ from: ["Europe/Brussels"], dryRun: false });
    expect(parseArgs(["--from", "Europe/Brussels", "--from", "America/New_York"])).toEqual({
      from: ["Europe/Brussels", "America/New_York"],
      dryRun: false,
    });
    expect(parseArgs([])).toMatch(/--from Europe\/Brussels/);
    expect(parseArgs(["--from"])).toMatch(/needs a zone/);
    expect(parseArgs(["--from", "Europe/Brusels"])).toMatch(/not a time zone/);
    expect(parseArgs(["--from", "UTC", "--force"])).toMatch(/Unknown option: --force/);
  });

  it("a dry run prints the counts and three examples, and changes nothing", async () => {
    const { repo, applied } = fakeRepo(marks("2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"));
    const out: string[] = [];
    expect(await migrateDays(repo, { from: ["Europe/Brussels"], dryRun: true }, (l) => out.push(l))).toBe(0);
    expect(applied).toEqual([]);
    expect(out).toContain("Habit marks to move: 4. Weekly intentions to move: 0. Scheduled days to move: 0.");
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
    expect(await migrateDays(repo, { from: ["Europe/Brussels"], dryRun: false }, (l) => out.push(l))).toBe(0);
    expect(applied[0]!.marks.map((m) => m.to.toISOString())).toEqual(["2026-11-24T00:00:00.000Z"]);
    expect(out.at(-1)).toMatch(/Done/);
  });

  it("refuses the wrong zone with exit code 1 and changes nothing", async () => {
    const { repo, applied } = fakeRepo(marks("2026-11-24"));
    const out: string[] = [];
    expect(await migrateDays(repo, { from: ["America/New_York"], dryRun: false }, (l) => out.push(l))).toBe(1);
    expect(applied).toEqual([]);
    expect(out.join("\n")).toMatch(/Refused: 1 values are not a midnight in America\/New_York/);
  });

  it("says there is nothing to move for data written in UTC", async () => {
    const days: StoredDays = { marks: [{ id: "m1", habitId: "h1", day: new Date("2026-11-24T00:00:00.000Z") }], intentions: [] };
    const { repo, applied } = fakeRepo(days);
    const out: string[] = [];
    expect(await migrateDays(repo, { from: ["Europe/Brussels"], dryRun: false }, (l) => out.push(l))).toBe(0);
    expect(applied).toEqual([]);
    expect(out.at(-1)).toBe("Nothing to move.");
  });

  it("moves scheduled days in two zones, says what each zone explained, and shows the task and its time (#136)", async () => {
    const days: StoredDays = {
      marks: [],
      intentions: [],
      scheduled: [
        { id: "t1", title: "Dentist", scheduledDay: brussels("2026-11-26"), scheduledTime: "09:30" },
        { id: "t2", title: "Call mum", scheduledDay: newYork("2026-12-03"), scheduledTime: null },
        { id: "t3", title: "Bins", scheduledDay: new Date("2026-11-27T00:00:00.000Z"), scheduledTime: null },
      ],
    };
    const { repo, applied } = fakeRepo(days);
    const out: string[] = [];
    expect(await migrateDays(repo, { from: ["Europe/Brussels", "America/New_York"], dryRun: true }, (l) => out.push(l))).toBe(0);
    expect(out).toContain("Habit marks to move: 0. Weekly intentions to move: 0. Scheduled days to move: 2.");
    expect(out).toContain("Values each zone explained: Europe/Brussels 1, America/New_York 1.");
    expect(out).toContain('  "Dentist" 09:30  2026-11-25T23:00:00.000Z  ->  2026-11-26');
    expect(out).toContain('  "Call mum"  2026-12-03T05:00:00.000Z  ->  2026-12-03');
    expect(applied).toEqual([]);

    // With Brussels alone, the New York one fits nothing: refused, nothing moved.
    const refused: string[] = [];
    expect(await migrateDays(repo, { from: ["Europe/Brussels"], dryRun: false }, (l) => refused.push(l))).toBe(1);
    expect(applied).toEqual([]);
    expect(refused.join("\n")).toMatch(/Task t2: 2026-12-03T05:00:00.000Z/);
  });
});
