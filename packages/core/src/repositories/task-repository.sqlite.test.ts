import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskService } from "../services/task-service.js";
import { PrismaTaskRepository } from "./task-repository.js";

/**
 * TaskService on a real SQLite database (#105 review of step 1.b): SQLite has
 * one writer, and several interactive transactions at once used to wait on
 * each other until Prisma timed them out (P2028 / P1008 after 5 s). The
 * in-memory repository cannot show that; this file can. The database is a
 * fresh file migrated with the project's own migrations.
 */
const coreDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
let dir: string;
let db: PrismaClient;
let tasks: TaskService;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-sqlite-"));
  const url = `file:${join(dir, "test.db")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: coreDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  tasks = new TaskService(new PrismaTaskRepository(db));
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("TaskService on SQLite: transactions at the same moment", () => {
  it("completes eight different tasks at once without an error", async () => {
    const created = await Promise.all(Array.from({ length: 8 }, (_, i) => tasks.create({ title: `Plain ${i}` })));
    const started = Date.now();
    const done = await Promise.all(created.map((t) => tasks.complete(t.id)));
    expect(done.map((t) => t.status)).toEqual(Array(8).fill("DONE"));
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("completes one recurring task eight times at once: no error, one successor", async () => {
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK" } });
    const results = await Promise.all(Array.from({ length: 8 }, () => tasks.complete(t.id)));
    expect(results.every((r) => r.status === "DONE")).toBe(true);
    const successors = await db.task.findMany({ where: { previousId: t.id } });
    expect(successors).toHaveLength(1);
  });

  it("reopens one task eight times at once without an error", async () => {
    const t = await tasks.create({ title: "Reopen me" });
    await tasks.complete(t.id);
    const results = await Promise.all(Array.from({ length: 8 }, () => tasks.reopen(t.id)));
    expect(results.every((r) => r.status === "TODO")).toBe(true);
  });
});
