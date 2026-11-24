import { describe, expect, it } from "vitest";
import { zonedMidnight } from "../domain/zoned.js";
import type { DayRepository } from "../repositories/day-repository.js";
import type { DayMigrationPlan, StoredDays } from "./day-migration.js";
import { knownZones, moveScheduledDays } from "./scheduled-day-move.js";
import { TimeZoneService } from "./time-zone-service.js";

const BRUSSELS = "Europe/Brussels";

function repo(days: StoredDays) {
  const applied: DayMigrationPlan[] = [];
  const r: DayRepository = { findAll: async () => days, apply: async (plan) => void applied.push(plan) };
  return { r, applied };
}

const task = (id: string, day: string, zone: string, scheduledTime: string | null = null) => ({
  id,
  title: `Task ${id}`,
  scheduledDay: zonedMidnight(day, zone),
  scheduledTime,
});

describe("the automatic move of old scheduled days (#136, legacy until #137)", () => {
  it("moves them in the known zone, all at once, and reports three examples (title, before, after)", async () => {
    const { r, applied } = repo({
      marks: [{ id: "m1", habitId: "h", day: zonedMidnight("2026-11-24", BRUSSELS) }],
      intentions: [],
      scheduled: [task("a", "2026-03-28", BRUSSELS), task("b", "2026-07-02", BRUSSELS), task("c", "2026-11-26", BRUSSELS, "09:30"), task("d", "2026-11-27", BRUSSELS)],
    });
    const out = await moveScheduledDays(r, [BRUSSELS]);
    expect(out.kind).toBe("moved");
    expect(applied).toHaveLength(1);
    expect(applied[0]!.scheduled.map((m) => m.to.toISOString().slice(0, 10))).toEqual(["2026-03-28", "2026-07-02", "2026-11-26", "2026-11-27"]);
    // Habit marks are not moved here: their zone is the old server's.
    expect(applied[0]!.marks).toEqual([]);
    if (out.kind !== "moved") throw new Error();
    expect(out.lines.slice(1)).toEqual([
      '  "Task a"  2026-03-27T23:00:00.000Z  ->  2026-03-28', // winter
      '  "Task b"  2026-07-01T22:00:00.000Z  ->  2026-07-02', // summer
      '  "Task c" 09:30  2026-11-25T23:00:00.000Z  ->  2026-11-26', // with a time
    ]);
  });

  it("refuses as a whole when one fits no known zone", async () => {
    const { r, applied } = repo({ marks: [], intentions: [], scheduled: [task("a", "2026-11-26", BRUSSELS), task("b", "2026-11-26", "America/New_York")] });
    const out = await moveScheduledDays(r, [BRUSSELS]);
    expect(out).toMatchObject({ kind: "refused", count: 2 });
    expect(applied).toEqual([]);
    if (out.kind === "refused") expect(out.lines.join("\n")).toMatch(/days-migrate\.js --from <zone> --dry-run/);
  });

  it("waits when no zone is known, and does nothing when all are plain", async () => {
    const old = repo({ marks: [], intentions: [], scheduled: [task("a", "2026-11-26", BRUSSELS)] });
    expect(await moveScheduledDays(old.r, [])).toMatchObject({ kind: "no-zone", count: 1 });
    expect(old.applied).toEqual([]);
    const plain = repo({ marks: [], intentions: [], scheduled: [{ id: "a", title: "x", scheduledDay: new Date("2026-11-26T00:00:00Z"), scheduledTime: null }] });
    expect(await moveScheduledDays(plain.r, [BRUSSELS])).toEqual({ kind: "nothing" });
  });

  it("knows the reported zone, then TZ", () => {
    expect(knownZones("Europe/Brussels", { TZ: "America/New_York" })).toEqual(["Europe/Brussels", "America/New_York"]);
    expect(knownZones(null, { TZ: "" })).toEqual([]);
    expect(knownZones("UTC", { TZ: "UTC" })).toEqual(["UTC"]);
  });
});

describe("the reported zone (#136)", () => {
  it("is written only when it changes, and says when it is the first", async () => {
    let stored: string | null = null;
    let writes = 0;
    const service = new TimeZoneService({ reported: async () => stored, setReported: async (z) => void ((stored = z), writes++) }, {});
    await service.load();
    expect(service.fallback()).toEqual({ zone: "UTC", source: "default" });
    expect(await service.report("Europe/Brussels")).toEqual({ changed: true, first: true });
    expect(await service.report("Europe/Brussels")).toEqual({ changed: false, first: false });
    expect(await service.report("America/New_York")).toEqual({ changed: true, first: false });
    expect(writes).toBe(2);
    expect(service.fallback()).toEqual({ zone: "America/New_York", source: "app" });
    await expect(service.report("Mars/Olympus")).rejects.toThrow(/not a time zone/);
  });
});
