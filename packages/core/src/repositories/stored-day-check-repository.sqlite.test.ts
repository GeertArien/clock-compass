import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zonedMidnight } from "../domain/zoned.js";
import { PrismaStoredDayCheckRepository } from "./stored-day-check-repository.js";

/**
 * The start-up check of #137 on a real SQLite file migrated with the
 * project's own migrations: old values (a zone's midnight, as written before
 * #112 and #136) are counted, plain dates are not, and nothing is changed.
 */
const coreDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
let dir: string;
let db: PrismaClient;
let repo: PrismaStoredDayCheckRepository;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-days-check-"));
  const url = `file:${join(dir, "test.db")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: coreDir, env: { ...process.env, DATABASE_URL: url }, stdio: "ignore" });
  db = new PrismaClient({ datasources: { db: { url } } });
  repo = new PrismaStoredDayCheckRepository(db);
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.habitMark.deleteMany();
  await db.habit.deleteMany();
  await db.weeklyIntention.deleteMany();
  await db.task.deleteMany();
});

const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const old = (day: string) => zonedMidnight(day, "Europe/Brussels");

describe("counting stored days that are not plain dates (#137)", () => {
  it("counts none when every one is a plain date (an empty database too)", async () => {
    expect(await repo.countNotPlain()).toBe(0);
    const habit = await db.habit.create({ data: { name: "Run" } });
    await db.habitMark.create({ data: { habitId: habit.id, day: utc("2026-11-24") } });
    await db.weeklyIntention.create({ data: { dimension: "MENTAL", weekStart: utc("2026-11-23"), text: "Read" } });
    await db.task.create({ data: { title: "Dentist", scheduledDay: utc("2026-11-26"), scheduledTime: "09:30" } });
    await db.task.create({ data: { title: "Someday" } });
    // plannedWeek is not checked: never compared, old values left as they are (#112).
    await db.task.create({ data: { title: "Rock", isBigRock: true, plannedWeek: old("2026-11-23") } });
    expect(await repo.countNotPlain()).toBe(0);
  });

  it("counts an old scheduled day, habit mark and weekly intention, and changes nothing", async () => {
    const habit = await db.habit.create({ data: { name: "Run" } });
    await db.habitMark.create({ data: { habitId: habit.id, day: old("2026-11-24") } });
    await db.weeklyIntention.create({ data: { dimension: "MENTAL", weekStart: old("2026-11-23"), text: "Read" } });
    const task = await db.task.create({ data: { title: "Dentist", scheduledDay: old("2026-11-26") } });
    expect(await repo.countNotPlain()).toBe(3);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).scheduledDay?.toISOString()).toBe("2026-11-25T23:00:00.000Z");
  });
});
