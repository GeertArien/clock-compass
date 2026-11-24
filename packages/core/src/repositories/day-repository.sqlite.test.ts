import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { zonedMidnight } from "../domain/zoned.js";
import { countNotPlain, planDayMigration } from "../services/day-migration.js";
import { PrismaDayRepository } from "./day-repository.js";

/**
 * The move to plain dates (#112) on a real SQLite file migrated with the
 * project's own migrations: the rows as a server outside UTC wrote them, the
 * plan, the transaction, and a second run.
 */
const coreDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const BRUSSELS = "Europe/Brussels";
let dir: string;
let db: PrismaClient;
let repo: PrismaDayRepository;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-days-"));
  const url = `file:${join(dir, "test.db")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: coreDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  repo = new PrismaDayRepository(db);
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.habitMark.deleteMany();
  await db.habit.deleteMany();
  await db.weeklyIntention.deleteMany();
});

/** A day as a server in `zone` stored it before #112: its local midnight. */
const local = (day: string, zone: string) => zonedMidnight(day, zone);
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const stored = async () =>
  (await db.habitMark.findMany({ orderBy: { day: "asc" } })).map((m) => m.day.toISOString());

describe("moving stored days to plain dates (#112)", () => {
  it("leaves data written in UTC untouched", async () => {
    const habit = await db.habit.create({ data: { name: "Run" } });
    await db.habitMark.createMany({ data: [{ habitId: habit.id, day: utc("2026-11-23") }, { habitId: habit.id, day: utc("2026-11-24") }] });
    await db.weeklyIntention.create({ data: { dimension: "MENTAL", weekStart: utc("2026-11-23"), text: "Read" } });

    const plan = planDayMigration(await repo.findAll(), BRUSSELS);
    expect(plan).toMatchObject({ marks: [], intentions: [], deleteMarks: [], deleteIntentions: [], refused: [], alreadyPlain: 3 });
    expect(countNotPlain(await repo.findAll())).toBe(0);
  });

  it("moves Brussels data to the same dates, and a second run changes nothing", async () => {
    const habit = await db.habit.create({ data: { name: "Run" } });
    // 29 March 2026 is the spring clock change; 25 October the autumn one.
    const days = ["2026-03-29", "2026-03-30", "2026-10-25", "2026-11-24"];
    await db.habitMark.createMany({ data: days.map((d) => ({ habitId: habit.id, day: local(d, BRUSSELS) })) });
    await db.weeklyIntention.create({ data: { dimension: "MENTAL", weekStart: local("2026-11-23", BRUSSELS), text: "Read" } });
    expect(countNotPlain(await repo.findAll())).toBe(5);

    const plan = planDayMigration(await repo.findAll(), BRUSSELS);
    expect(plan.marks).toHaveLength(4);
    expect(plan.intentions).toHaveLength(1);
    await repo.apply(plan);

    expect(await stored()).toEqual(days.map((d) => `${d}T00:00:00.000Z`));
    expect((await db.weeklyIntention.findFirstOrThrow()).weekStart.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(countNotPlain(await repo.findAll())).toBe(0);

    const again = planDayMigration(await repo.findAll(), BRUSSELS);
    expect(again.marks.length + again.intentions.length + again.deleteMarks.length + again.deleteIntentions.length).toBe(0);
  });

  it("refuses a wrong zone and changes nothing", async () => {
    const habit = await db.habit.create({ data: { name: "Run" } });
    await db.habitMark.create({ data: { habitId: habit.id, day: local("2026-11-24", BRUSSELS) } });
    const before = await stored();

    const plan = planDayMigration(await repo.findAll(), "America/New_York");
    expect(plan.refused).toHaveLength(1);
    expect(plan.marks).toEqual([]);
    expect(await stored()).toEqual(before);
  });

  it("handles a deployment that ran in UTC first and in Brussels later", async () => {
    const habit = await db.habit.create({ data: { name: "Run" } });
    await db.habitMark.create({ data: { habitId: habit.id, day: utc("2026-11-20") } }); // UTC days: already plain
    await db.habitMark.create({ data: { habitId: habit.id, day: local("2026-11-24", BRUSSELS) } });

    const plan = planDayMigration(await repo.findAll(), BRUSSELS);
    expect(plan.alreadyPlain).toBe(1);
    expect(plan.refused).toEqual([]);
    await repo.apply(plan);
    expect(await stored()).toEqual(["2026-11-20T00:00:00.000Z", "2026-11-24T00:00:00.000Z"]);
  });

  it("removes duplicate marks and keeps the newest intention text", async () => {
    const habit = await db.habit.create({ data: { name: "Run" } });
    // The same day written once in UTC and once in Brussels.
    await db.habitMark.create({ data: { habitId: habit.id, day: utc("2026-11-24") } });
    await db.habitMark.create({ data: { habitId: habit.id, day: local("2026-11-24", BRUSSELS) } });
    await db.weeklyIntention.create({ data: { dimension: "MENTAL", weekStart: utc("2026-11-23"), text: "Old" } });
    await new Promise((r) => setTimeout(r, 5));
    await db.weeklyIntention.create({ data: { dimension: "MENTAL", weekStart: local("2026-11-23", BRUSSELS), text: "Newer" } });

    const plan = planDayMigration(await repo.findAll(), BRUSSELS);
    expect(plan.deleteMarks).toHaveLength(1);
    expect(plan.deleteIntentions).toHaveLength(1);
    await repo.apply(plan);

    expect(await stored()).toEqual(["2026-11-24T00:00:00.000Z"]);
    const intentions = await db.weeklyIntention.findMany();
    expect(intentions.map((i) => [i.weekStart.toISOString(), i.text])).toEqual([["2026-11-23T00:00:00.000Z", "Newer"]]);
  });
});
