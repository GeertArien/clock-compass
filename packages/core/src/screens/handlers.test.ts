import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validatePayload } from "@clock-compass/assistant-catalog";
import { DEFAULT_DATA_POLICY } from "../assistant/data-policy.js";
import { fakeServices } from "../assistant/test-fakes.js";
import { runScreen } from "./handlers.js";

// Friday 20 November 2026 in Brussels; the week of Monday 16 November.
const ctx = { policy: DEFAULT_DATA_POLICY, now: new Date("2026-11-20T09:00:00Z"), timeZone: "Europe/Brussels" };
const texts = (messages: unknown[]) =>
  JSON.stringify(messages)
    .match(/"text":"[^"]*"/g)!
    .map((t) => t.slice(8, -1));

describe("showWeek (#118, step 1)", () => {
  it("draws this week's rocks and the tasks on each day, validated by the catalog", async () => {
    const outcome = await runScreen("showWeek", {}, fakeServices(), ctx);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(validatePayload(outcome.messages)).toEqual({ ok: true });
    const lines = texts(outcome.messages);
    expect(lines[0]).toBe("## Week of 16 November");
    expect(lines).toContain("○ Plan the garden");
    // Scheduled for Saturday 21 November at 09:00 by a Brussels browser.
    expect(lines.slice(lines.indexOf("**Saturday 21**"), lines.indexOf("**Saturday 21**") + 2)).toEqual(["**Saturday 21**", "09:00 Plan the garden"]);
    expect(lines.filter((l) => l === "Nothing scheduled")).toHaveLength(6);
    // The week in words: all a host that draws no page shows (#118).
    expect(outcome.summary).toBe(
      "This week (16–22 November 2026, Europe/Brussels): 1 big rock, 0 done: Plan the garden. Saturday 21: 09:00 Plan the garden.",
    );
  });

  it("shows another week on request, and refuses a date that is not a Monday", async () => {
    const next = await runScreen("showWeek", { week: "2026-11-23" }, fakeServices(), ctx);
    expect(next).toMatchObject({ ok: true, summary: "The week of 23–29 November 2026: 1 big rock, 0 done: Plan the garden. Nothing is scheduled." });
    expect(await runScreen("showWeek", { week: "2026-11-24" }, fakeServices(), ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/a Monday/) });
  });

  it("is refused when tasks are not shared with AI", async () => {
    expect(await runScreen("showWeek", {}, fakeServices(), { ...ctx, policy: { ...DEFAULT_DATA_POLICY, tasks: false } })).toEqual({
      ok: false,
      error: "This shows data the user has not shared with AI.",
    });
  });

  it("a task scheduled for Thursday shows on Thursday in every zone (#136)", async () => {
    const services = fakeServices();
    const task = { ...(await services.tasks.list({}))[0]!, id: "t9", title: "Dentist", scheduledDay: new Date("2026-11-26T00:00:00Z"), scheduledTime: "09:30", isBigRock: false };
    services.tasks.list = async () => [task];
    const now = new Date("2026-11-24T12:00:00Z");
    for (const timeZone of ["UTC", "Europe/Brussels", "America/New_York"]) {
      const out = await runScreen("showWeek", {}, services, { policy: DEFAULT_DATA_POLICY, now, timeZone });
      if (!out.ok) throw new Error(out.error);
      const lines = texts(out.messages);
      expect(lines[lines.indexOf("09:30 Dentist") - 1]).toBe("**Thursday 26**");
    }
  });

  it("says the week in words across a month, with done tasks marked", async () => {
    const services = fakeServices();
    const base = (await services.tasks.list({}))[0]!;
    services.tasks.list = async () => [
      { ...base, id: "a", title: "Dentist", scheduledDay: new Date("2026-12-03T00:00:00Z"), scheduledTime: "09:30", isBigRock: false, status: "DONE" },
      { ...base, id: "b", title: "Bins out", scheduledDay: new Date("2026-12-03T00:00:00Z"), scheduledTime: null, isBigRock: false },
    ];
    services.tasks.bigRocks = async () => [];
    const out = await runScreen("showWeek", { week: "2026-11-30" }, services, { policy: DEFAULT_DATA_POLICY, now: new Date("2026-11-24T12:00:00Z"), timeZone: "UTC" });
    if (!out.ok) throw new Error(out.error);
    expect(out.summary).toBe("The week of 30 November – 6 December 2026: No big rocks pinned. Thursday 3: 09:30 Dentist ✓, Bins out.");
  });

  it("builds exactly the page test's fixture (apps/web/src/mcp-app/week-result.fixture.json)", async () => {
    const outcome = await runScreen("showWeek", {}, fakeServices(), ctx);
    if (!outcome.ok) throw new Error(outcome.error);
    const fixture = JSON.parse(readFileSync(new URL("../../../../apps/web/src/mcp-app/week-result.fixture.json", import.meta.url), "utf8"));
    expect(fixture).toEqual({ content: [{ type: "text", text: outcome.summary }], structuredContent: { messages: outcome.messages } });
  });
});

describe("showMatrix, showHabits and showPeople (#118, step 2)", () => {
  const off = (category: string) => ({ ...ctx, policy: { ...DEFAULT_DATA_POLICY, [category]: false } });
  const fixture = (name: string) =>
    JSON.parse(readFileSync(new URL(`../../../../apps/web/src/mcp-app/${name}`, import.meta.url), "utf8"));

  it("the matrix: the app's QuadrantBoard with the open tasks, and the reads its cards need", async () => {
    const outcome = await runScreen("showMatrix", {}, fakeServices(), ctx);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(validatePayload(outcome.messages)).toEqual({ ok: true });
    const board = JSON.stringify(outcome.messages).match(/"component":"QuadrantBoard","taskIds":\[[^\]]*\]/)![0];
    // Open work only: the yearly task that shows later is left out.
    expect(board).toBe('"component":"QuadrantBoard","taskIds":["t1","t2","t3"]');
    expect(outcome.reads!.map((r) => r.name)).toEqual(["listTasks", "getCompass"]);
    // The page gets the goals and projects the cards name, never the mission.
    expect(Object.keys(outcome.reads![1]!.result as object)).toEqual(["goals", "projects"]);
    expect(outcome.summary).toBe(
      "Your open tasks by quadrant (3): Q1 urgent and important (1): Call the plumber. Q2 important, not urgent (1): Plan the garden (big rock). " +
        "Q3 urgent, not important (1): Reply to overdue email. Q4 neither (0).",
    );
  });

  it("the matrix says on the page, as in words, when it shows only the first tasks", async () => {
    const services = fakeServices();
    const base = (await services.tasks.list({}))[0]!;
    const many = Array.from({ length: 233 }, (_, i) => ({ ...base, id: `m${i}`, title: `Task ${i}`, isBigRock: false, later: false }));
    services.tasks.list = async () => many;
    const outcome = await runScreen("showMatrix", {}, services, ctx);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(texts(outcome.messages)).toContain("The first 200 of 233 open tasks.");
    expect(outcome.summary).toMatch(/^Your open tasks by quadrant \(the first 200 of 233\):/);
    // Not cut: no such line.
    expect(texts((await runScreen("showMatrix", {}, fakeServices(), ctx) as { messages: unknown[] }).messages)).not.toContain(
      expect.stringMatching(/^The first/),
    );
  });

  it("the matrix follows the switches: refused without tasks; without goals and projects, no compass read", async () => {
    expect(await runScreen("showMatrix", {}, fakeServices(), off("tasks"))).toMatchObject({ ok: false });
    const outcome = await runScreen("showMatrix", {}, fakeServices(), off("goalsAndProjects"));
    if (!outcome.ok) throw new Error(outcome.error);
    expect(outcome.reads!.map((r) => r.name)).toEqual(["listTasks"]);
    // A card shows no notes: none reach the page, even with task notes shared.
    expect(JSON.stringify(await runScreen("showMatrix", {}, fakeServices(), ctx))).not.toMatch(/boiler/);
  });

  it("the habits: the app's HabitCheckIn, with the habits read", async () => {
    const outcome = await runScreen("showHabits", {}, fakeServices(), ctx);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(validatePayload(outcome.messages)).toEqual({ ok: true });
    expect(JSON.stringify(outcome.messages)).toMatch(/"component":"HabitCheckIn","habitIds":\["h1"\]/);
    expect(outcome.reads).toEqual([{ name: "listHabits", args: {}, result: [expect.objectContaining({ id: "h1", name: "Morning run" })] }]);
    expect(outcome.summary).toBe("Habits this week: Morning run (physical): 2 of 3 this week, not yet today, a 4-week streak.");
    expect(await runScreen("showHabits", {}, fakeServices(), off("habitsAndRenewal"))).toMatchObject({ ok: false });
  });

  it("the people: commitments and where each stands; notes never, even when shared", async () => {
    const shared = { ...ctx, policy: { ...DEFAULT_DATA_POLICY, personNotes: true, ebaEntryNotes: true } };
    const outcome = await runScreen("showPeople", {}, fakeServices(), shared);
    if (!outcome.ok) throw new Error(outcome.error);
    expect(validatePayload(outcome.messages)).toEqual({ ok: true });
    const lines = texts(outcome.messages);
    expect(lines).toContain("**Sam** · kid");
    expect(lines).toContain("● Monthly adventure: every month, overdue, last done 12 September");
    expect(lines).toContain("Emotional bank account: +3");
    expect(JSON.stringify(outcome)).not.toMatch(/SENTINEL/);
    expect(outcome.summary).toMatch(/^Sam \(kid\): Monthly adventure: every month, overdue, last done 12 September; Bedtime story: every week, on track/);
  });

  it("the people filtered by status, and refused when people are not shared", async () => {
    const overdue = await runScreen("showPeople", { status: "OVERDUE" }, fakeServices(), ctx);
    if (!overdue.ok) throw new Error(overdue.error);
    expect(texts(overdue.messages)[0]).toBe("## Overdue");
    expect(overdue.summary).not.toMatch(/Bedtime story/);
    const dueSoon = await runScreen("showPeople", { status: "DUE_SOON" }, fakeServices(), ctx);
    expect(dueSoon).toMatchObject({ ok: true, summary: "Nothing is due soon." });
    expect(await runScreen("showPeople", {}, fakeServices(), off("people"))).toMatchObject({ ok: false });
  });

  it("builds exactly the page test's fixtures for the matrix and the habits", async () => {
    for (const [name, file] of [["showMatrix", "matrix-result.fixture.json"], ["showHabits", "habits-result.fixture.json"]] as const) {
      const outcome = await runScreen(name, {}, fakeServices(), ctx);
      if (!outcome.ok) throw new Error(outcome.error);
      expect(fixture(file)).toEqual({
        content: [{ type: "text", text: outcome.summary }],
        structuredContent: { messages: outcome.messages, reads: outcome.reads },
      });
    }
  });
});
