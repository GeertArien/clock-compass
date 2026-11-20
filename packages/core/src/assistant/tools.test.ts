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

  it("drops the balance when ebaBalance is off", async () => {
    const outcome = await call("list_people", {}, { ...DEFAULT_DATA_POLICY, ebaBalance: false });
    expect(JSON.stringify(outcome)).not.toContain("emotionalBankAccountBalance");
  });

  it("drops a role's mission line when mission is off", async () => {
    expect(await call("list_roles", {}, { ...DEFAULT_DATA_POLICY, mission: false })).toEqual({
      ok: true,
      result: [{ id: "r1", name: "Parent" }],
    });
  });

  it("does not offer, and refuses to run, a tool for a switched-off category", async () => {
    const policy = { ...DEFAULT_DATA_POLICY, people: false };
    const offered = toolSpecs(READ_TOOLS, policy).map((t) => t.name);
    expect(offered).not.toContain("list_people");
    expect(offered).not.toContain("overdue_commitments");
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

  it("returns the big rocks as the app's rocks jar does (every pinned task), not by the server's week", async () => {
    // The fake bigRocksForWeek returns [] as the real one does across time zones.
    expect(await call("big_rocks_this_week")).toMatchObject({ ok: true, result: [{ id: "t1", isBigRock: true }] });
  });

  it("returns goals with progress, the mission, habits and renewal", async () => {
    expect(await call("list_goals")).toMatchObject({
      ok: true,
      result: [{ id: "g1", progress: { done: 1, total: 3 } }],
    });
    expect(await call("get_mission")).toMatchObject({ ok: true, result: { content: "Put first things first." } });
    expect(await call("list_habits")).toMatchObject({ ok: true, result: [{ name: "Morning run", streak: 4 }] });
    expect(await call("renewal_summary")).toMatchObject({ ok: true, result: [{ dimension: "PHYSICAL", total: 3 }] });
    expect(await call("overdue_commitments")).toMatchObject({ ok: true, result: [{ personName: "Sam" }] });
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
