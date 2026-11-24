import { describe, expect, it } from "vitest";
import { READ_LIST, mcpToolName, OPERATION_LIST } from "@clock-compass/assistant-catalog";
import { DEFAULT_DATA_POLICY, type DataPolicy } from "../assistant/data-policy.js";
import { EBA_NOTE, PERSON_NOTE, fakeServices } from "../assistant/test-fakes.js";
import { FakeTaskRepository } from "../services/fake-task-repository.js";
import { TaskService } from "../services/task-service.js";
import { runRead, type ReadServices } from "./handlers.js";

const now = new Date("2026-11-20T09:00:00Z");
const ctx = (policy: DataPolicy = DEFAULT_DATA_POLICY) => ({ policy, now, timeZone: "Europe/Brussels" });
const ok = async (name: string, args: unknown = {}, services: ReadServices = fakeServices(), policy?: DataPolicy) => {
  const outcome = await runRead(name, args, services, ctx(policy));
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result as never;
};

describe("the read declarations (#117)", () => {
  it("are six, read-only, with categories and strict inputs, named by the operations' rule", () => {
    expect(READ_LIST.map((r) => mcpToolName(r.name))).toEqual([
      "list_tasks",
      "big_rocks_this_week",
      "get_compass",
      "list_people",
      "list_habits",
      "renewal_overview",
    ]);
    const writes = new Set(OPERATION_LIST.map((o) => mcpToolName(o.name)));
    for (const read of READ_LIST) {
      expect(read.hints, read.name).toEqual({ readOnlyHint: true });
      expect(read.categories.length, read.name).toBeGreaterThan(0);
      expect(writes.has(mcpToolName(read.name)), read.name).toBe(false);
      expect(read.input.safeParse({ unknownArgument: 1 }).success, read.name).toBe(false);
    }
  });
});

describe("the fields each read returns", () => {
  it("a task: what it is, where it stands, and what an edit names", async () => {
    const { tasks } = await ok("listTasks", { quadrant: "Q2" });
    expect(Object.keys(tasks[0]).sort()).toEqual(
      [
        "completedAt",
        "dueDate",
        "goalId",
        "id",
        "important",
        "isBigRock",
        "later",
        "notes",
        "proactivity",
        "projectId",
        "quadrant",
        "repeat",
        "repeats",
        "scheduledDay",
        "scheduledTime",
        "showFrom",
        "status",
        "title",
        "urgent",
      ].sort(),
    );
  });

  it("a repeating task carries its whole rule", async () => {
    const { tasks } = await ok("listTasks", { includeLater: true, titleContains: "kraan" });
    expect(tasks).toEqual([
      expect.objectContaining({
        id: "t4",
        repeat: { unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21 },
        repeats: "every year, shown 21 days before it is due",
        later: true,
        showFrom: "2027-10-11",
      }),
    ]);
  });

  it("a person: names, commitments with plain days, the balance; no notes by default", async () => {
    const [person] = (await ok("listPeople")) as unknown as { commitments: Record<string, unknown>[] }[];
    expect(Object.keys(person!).sort()).toEqual(["commitments", "emotionalBankAccountBalance", "id", "name", "relationship"]);
    expect(Object.keys(person!.commitments[0]!).sort()).toEqual(
      ["cadence", "currentStreak", "history", "id", "lastDone", "nextDue", "status", "title"].sort(),
    );
    expect(person!.commitments[0]!.lastDone).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the notes on people and bank-account entries (owner decision on #117)", () => {
  const all = async (policy: DataPolicy) => {
    const answers: Record<string, string> = {};
    for (const read of READ_LIST) answers[read.name] = JSON.stringify(await runRead(read.name, {}, fakeServices(), ctx(policy)));
    return answers;
  };

  it("are in no read's answer with both switches off (the default)", async () => {
    for (const [name, text] of Object.entries(await all(DEFAULT_DATA_POLICY))) {
      expect(text, name).not.toContain(PERSON_NOTE);
      expect(text, name).not.toContain(EBA_NOTE);
    }
  });

  it("with one switch on, are only in the read that owns that field", async () => {
    const answers = await all({ ...DEFAULT_DATA_POLICY, ebaEntryNotes: true });
    for (const [name, text] of Object.entries(answers)) {
      expect(text, name).not.toContain(PERSON_NOTE);
      expect(text.includes(EBA_NOTE), name).toBe(name === "listPeople");
    }
  });
});

describe("listTasks", () => {
  async function many(count: number) {
    const tasks = new TaskService(new FakeTaskRepository());
    for (let i = 0; i < count; i++) {
      await tasks.create({ title: `Task ${String(i).padStart(3, "0")}`, important: i % 2 === 0, urgent: i % 3 === 0 });
    }
    return { ...fakeServices(), tasks } as ReadServices;
  }

  it("pages through 120 tasks without loss or repeat", async () => {
    const services = await many(120);
    const seen: string[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const page: { total: number; nextOffset: number | null; tasks: { id: string }[] } = await ok("listTasks", { offset, limit: 50 }, services);
      expect(page.total).toBe(120);
      seen.push(...page.tasks.map((t) => t.id));
      offset = page.nextOffset;
      pages++;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(120);
  });

  it("counts every quadrant before the quadrant filter, and filters by title, inbox and big rock", async () => {
    const services = await many(12);
    const all = await ok("listTasks", {}, services);
    const q2 = await ok("listTasks", { quadrant: "Q2" }, services);
    expect((q2 as { counts: unknown }).counts).toEqual((all as { counts: unknown }).counts);
    expect((q2 as { total: number }).total).toBe((all as { counts: { Q2: number } }).counts.Q2);
    expect(await ok("listTasks", { titleContains: "task 007" }, services)).toMatchObject({ total: 1, tasks: [{ title: "Task 007" }] });
    expect(await ok("listTasks", { inbox: true }, services)).toMatchObject({ total: 12 });
    expect(await ok("listTasks", { bigRock: true }, services)).toMatchObject({ total: 0 });
  });
});

describe("renewalOverview", () => {
  const withTrends = () => {
    const services = fakeServices() as ReadServices & { renewal: { trends: unknown } };
    services.renewal.trends = async () => ({
      thisWeek: 3,
      lastWeek: 1,
      longestStreak: { weeks: 4, habitName: "Morning run" },
      goalMomentum: [{ goalId: "g1", title: "Grow our own vegetables", pct: 40 }],
      heatmap: Array.from({ length: 12 }, () => [0, 0, 0, 0, 0, 0, 0]),
    });
    return services;
  };

  it("adds the trends on request; goal names only when goals are shared", async () => {
    expect(await ok("renewalOverview", {}, withTrends())).not.toHaveProperty("trends");
    const on = await ok("renewalOverview", { includeTrends: true }, withTrends());
    expect(on).toMatchObject({ trends: { thisWeek: 3, goalMomentum: [{ title: "Grow our own vegetables" }] } });
    const off = await ok("renewalOverview", { includeTrends: true }, withTrends(), { ...DEFAULT_DATA_POLICY, goalsAndProjects: false });
    expect((off as { trends: object }).trends).not.toHaveProperty("goalMomentum");
  });
});

describe("runRead", () => {
  it("refuses an unknown read, a read with its data off, and bad arguments", async () => {
    expect(await runRead("dropTables", {}, fakeServices(), ctx())).toEqual({ ok: false, error: 'Unknown read "dropTables".' });
    expect(await runRead("listPeople", {}, fakeServices(), ctx({ ...DEFAULT_DATA_POLICY, people: false }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/not shared/),
    });
    expect(await runRead("listTasks", { limit: 0 }, fakeServices(), ctx())).toMatchObject({ ok: false, error: expect.stringMatching(/^Invalid arguments: limit/) });
  });
});
