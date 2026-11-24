import { describe, expect, it } from "vitest";
import { DATA_CATEGORIES, DEFAULT_DATA_POLICY, type DataPolicy } from "./data-policy.js";
import { EBA_NOTE, PERSON_NOTE, fakeServices } from "./test-fakes.js";
import { READ_TOOLS, isTimeZone, localDay, runTool, toolSpecs, type ToolContext } from "./tools.js";

const now = new Date("2026-11-20T09:00:00Z");
const context = (policy: DataPolicy = DEFAULT_DATA_POLICY, timeZone = "UTC"): ToolContext => ({
  services: fakeServices(),
  policy,
  now,
  timeZone,
});

async function call(name: string, args: unknown = {}, policy?: DataPolicy, timeZone?: string) {
  return runTool(READ_TOOLS, name, args, context(policy, timeZone));
}

describe("the default data policy (owner decision on #62)", () => {
  it("shares everything except notes on people and bank-account entry notes", () => {
    expect(DEFAULT_DATA_POLICY).toEqual({
      tasks: true,
      taskNotes: true,
      goalsAndProjects: true,
      mission: true,
      people: true,
      personNotes: false,
      ebaBalance: true,
      ebaEntryNotes: false,
      habitsAndRenewal: true,
    });
    expect(Object.keys(DEFAULT_DATA_POLICY).sort()).toEqual([...DATA_CATEGORIES].sort());
  });

  it("keeps both kinds of note out of every tool's result, although the data has them", async () => {
    const results: string[] = [];
    for (const tool of READ_TOOLS) {
      const outcome = await call(tool.name);
      expect(outcome, tool.name).toMatchObject({ ok: true });
      results.push(JSON.stringify(outcome));
    }
    const all = results.join("\n");
    expect(all).not.toContain(PERSON_NOTE);
    expect(all).not.toContain(EBA_NOTE);
    expect(all).not.toMatch(/recentBankAccountEntries|"notes":"SENTINEL/);
  });

  it("gives the people data the owner allowed: names, relationship, commitments with status and streaks, the balance", async () => {
    const outcome = await call("list_people");
    expect(outcome).toEqual({
      ok: true,
      result: [
        {
          id: "p1",
          name: "Sam",
          relationship: "kid",
          emotionalBankAccountBalance: 3,
          commitments: [
            expect.objectContaining({ title: "Monthly adventure", status: "OVERDUE", currentStreak: 0 }),
            expect.objectContaining({ title: "Bedtime story", status: "ON_TRACK", currentStreak: 7 }),
          ],
        },
      ],
    });
  });
});

describe("switching categories (what #94 will store)", () => {
  it("adds person notes and entry notes only when those categories are on", async () => {
    const both = await call("list_people", {}, { ...DEFAULT_DATA_POLICY, personNotes: true, ebaEntryNotes: true });
    expect(JSON.stringify(both)).toContain(PERSON_NOTE);
    expect(JSON.stringify(both)).toContain(EBA_NOTE);

    const notesOnly = await call("list_people", {}, { ...DEFAULT_DATA_POLICY, personNotes: true });
    expect(JSON.stringify(notesOnly)).toContain(PERSON_NOTE);
    expect(JSON.stringify(notesOnly)).not.toContain(EBA_NOTE);
  });

  it("sends task notes by default, and leaves them out of both task tools when taskNotes is off", async () => {
    const on = await call("list_tasks", { quadrant: "Q1" });
    expect(on).toMatchObject({ ok: true, result: { tasks: [{ id: "t3", notes: "Ask about the boiler too" }] } });
    const policy = { ...DEFAULT_DATA_POLICY, taskNotes: false };
    for (const name of ["list_tasks", "big_rocks_this_week"]) {
      const outcome = await call(name, {}, policy);
      expect(outcome, name).toMatchObject({ ok: true });
      expect(JSON.stringify(outcome), name).not.toMatch(/"notes"|boiler/);
    }
    // The tasks themselves are still there.
    expect(await call("big_rocks_this_week", {}, policy)).toMatchObject({ ok: true, result: [{ id: "t1" }] });
  });

  it("drops the balance when ebaBalance is off", async () => {
    const outcome = await call("list_people", {}, { ...DEFAULT_DATA_POLICY, ebaBalance: false });
    expect(JSON.stringify(outcome)).not.toContain("emotionalBankAccountBalance");
  });

  it("drops the mission and a role's mission line when mission is off, and says so", async () => {
    const outcome = await call("get_compass", {}, { ...DEFAULT_DATA_POLICY, mission: false });
    expect(outcome).toMatchObject({ ok: true, result: { roles: [{ id: "r1", name: "Parent" }], notShared: ["mission (and the mission lines of roles)"] } });
    const result = (outcome as { result: Record<string, unknown> }).result;
    expect(result).not.toHaveProperty("mission");
    expect((result.roles as object[])[0]).not.toHaveProperty("mission");
  });

  it("keeps the mission when goals and projects are off, and says which part is not shared", async () => {
    const outcome = await call("get_compass", {}, { ...DEFAULT_DATA_POLICY, goalsAndProjects: false });
    expect(outcome).toEqual({
      ok: true,
      result: { mission: expect.objectContaining({ content: "Put first things first." }), notShared: ["roles, goals and projects"] },
    });
    // Offered while either part is on; refused when both are off.
    const neither = { ...DEFAULT_DATA_POLICY, goalsAndProjects: false, mission: false };
    expect(toolSpecs(READ_TOOLS, neither).map((t) => t.name)).not.toContain("get_compass");
  });

  it("does not offer, and refuses to run, a tool for a switched-off category", async () => {
    const policy = { ...DEFAULT_DATA_POLICY, people: false };
    const offered = toolSpecs(READ_TOOLS, policy).map((t) => t.name);
    expect(offered).not.toContain("list_people");
    expect(offered).toContain("list_tasks");
    expect(await call("list_people", {}, policy)).toEqual({
      ok: false,
      error: '"list_people" reads data the user has not shared with the assistant.',
    });
  });
});

describe("the read tools", () => {
  it("lists open tasks by default, filtered by quadrant", async () => {
    expect(await call("list_tasks", { quadrant: "Q2" })).toMatchObject({
      ok: true,
      result: { total: 1, tasks: [{ id: "t1", title: "Plan the garden", quadrant: "Q2", isBigRock: true }] },
    });
  });

  it("gives a scheduled day in the user's time zone, and plain dates as entered", async () => {
    // Stored as 2026-11-20T23:00Z: Brussels' midnight of Saturday 21 Nov.
    const brussels = await call("list_tasks", { quadrant: "Q2" }, undefined, "Europe/Brussels");
    expect(brussels).toMatchObject({
      ok: true,
      result: { tasks: [{ id: "t1", scheduledDay: "2026-11-21", scheduledTime: "09:00", dueDate: "2026-11-27" }] },
    });
    const utc = await call("list_tasks", { quadrant: "Q2" }, undefined, "UTC");
    expect(utc).toMatchObject({ ok: true, result: { tasks: [{ scheduledDay: "2026-11-20", dueDate: "2026-11-27" }] } });
    expect(localDay(new Date("2026-11-21T03:00:00Z"), "America/New_York")).toBe("2026-11-20");
    expect(localDay(null, "UTC")).toBeNull();
  });

  it("knows a time zone from anything else", () => {
    expect(isTimeZone("Europe/Brussels")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    for (const bad of ["Mars/Olympus_Mons", "", "x".repeat(65), 42, null]) expect(isTimeZone(bad)).toBe(false);
  });

  it("returns the big rocks from the service (every pinned task, #98)", async () => {
    expect(await call("big_rocks_this_week")).toMatchObject({ ok: true, result: [{ id: "t1", isBigRock: true }] });
  });

  it("returns goals with progress, the mission, habits and renewal", async () => {
    expect(await call("get_compass")).toMatchObject({
      ok: true,
      result: {
        mission: { content: "Put first things first." },
        roles: [{ id: "r1", name: "Parent" }],
        goals: [{ id: "g1", progress: { done: 1, total: 3 } }],
        notShared: [],
      },
    });
    expect(await call("list_habits")).toMatchObject({ ok: true, result: [{ name: "Morning run", streak: 4 }] });
    expect(await call("renewal_overview")).toMatchObject({
      ok: true,
      result: { thisWeek: [{ dimension: "PHYSICAL", total: 3, intention: "Three runs this week" }] },
    });
  });

  it("lists only the commitments that are behind, with their person, for status OVERDUE", async () => {
    const outcome = await call("list_people", { status: "OVERDUE" });
    expect(outcome).toMatchObject({ ok: true, result: [{ id: "p1", name: "Sam", commitments: [{ title: "Monthly adventure", status: "OVERDUE" }] }] });
    expect((outcome as { result: { commitments: unknown[] }[] }).result[0]!.commitments).toHaveLength(1);
    expect(await call("list_people", { status: "DUE_SOON" })).toEqual({ ok: true, result: [] });
  });

  it("reports invalid arguments and unknown tools to the model instead of throwing", async () => {
    expect(await call("list_tasks", { quadrant: "Q9" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Invalid arguments for "list_tasks": quadrant:/),
    });
    expect(await call("list_tasks", { deleteEverything: true })).toMatchObject({ ok: false });
    expect(await call("list_tasks", "not an object")).toMatchObject({ ok: false });
    expect(await call("drop_tables")).toEqual({ ok: false, error: 'Unknown tool "drop_tables".' });
  });

  it("hides a service failure's internals", async () => {
    const services = fakeServices();
    services.tasks.list = async () => {
      throw new Error("SQLITE_BUSY at /var/lib/app.db");
    };
    const outcome = await runTool(READ_TOOLS, "list_tasks", {}, { services, policy: DEFAULT_DATA_POLICY, now, timeZone: "UTC" });
    expect(outcome).toEqual({ ok: false, error: '"list_tasks" failed. Try again or answer without it.' });
  });

  it("describes every tool to the model as a JSON Schema object", () => {
    const specs = toolSpecs(READ_TOOLS, DEFAULT_DATA_POLICY);
    expect(specs).toHaveLength(READ_TOOLS.length);
    for (const spec of specs) {
      expect(spec.inputSchema, spec.name).toMatchObject({ type: "object" });
      expect(spec.inputSchema, spec.name).not.toHaveProperty("$schema");
      expect(spec.description.length, spec.name).toBeGreaterThan(10);
    }
    expect(specs.find((s) => s.name === "list_tasks")!.inputSchema).toMatchObject({
      properties: { quadrant: { enum: ["Q1", "Q2", "Q3", "Q4"] } },
      additionalProperties: false,
    });
  });

  it("has no tool that writes", () => {
    for (const tool of READ_TOOLS) {
      expect(tool.name).toMatch(/^(list|get|big_rocks|overdue|renewal)_/);
    }
  });
});

describe("recurring tasks in the read tools (#105 step 3)", () => {
  it("leaves out occurrences that show later, unless includeLater; says how a task repeats", async () => {
    const open = (await call("list_tasks")) as { result: { tasks: { id: string }[] } };
    expect(open.result.tasks.map((t) => t.id)).not.toContain("t4");
    const all = (await call("list_tasks", { includeLater: true })) as { result: { tasks: Record<string, unknown>[] } };
    expect(all.result.tasks.find((t) => t.id === "t4")).toMatchObject({
      title: "Buitenkraan afsluiten",
      repeats: "every year, shown 21 days before it is due",
      later: true,
      showFrom: "2027-10-11",
      dueDate: "2027-11-01",
    });
    expect(all.result.tasks.find((t) => t.id === "t2")).toMatchObject({ repeats: null, later: false, showFrom: null });
  });
});
