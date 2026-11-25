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

  it("a task still in the old form (#136, legacy until #137) is read in the zone it is given", async () => {
    // Scheduled from a Brussels phone before #136: stored as 2026-11-25T23:00Z.
    const services = fakeServices();
    const task = { ...(await services.tasks.list({}))[0]!, id: "t9", title: "Dentist", scheduledDay: new Date("2026-11-25T23:00:00Z"), scheduledTime: "09:30", isBigRock: false };
    services.tasks.list = async () => [task];
    const now = new Date("2026-11-24T12:00:00Z");
    const out = await runScreen("showWeek", {}, services, { policy: DEFAULT_DATA_POLICY, now, timeZone: "Europe/Brussels" });
    if (!out.ok) throw new Error(out.error);
    const lines = texts(out.messages);
    expect(lines[lines.indexOf("09:30 Dentist") - 1]).toBe("**Thursday 26**");
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
