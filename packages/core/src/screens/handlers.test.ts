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
    expect(outcome.summary).toBe("Shown: the week of 2026-11-16, this week in Europe/Brussels, 1 big rock (0 done), 1 scheduled task.");
  });

  it("shows another week on request, and refuses a date that is not a Monday", async () => {
    const next = await runScreen("showWeek", { week: "2026-11-23" }, fakeServices(), ctx);
    expect(next).toMatchObject({ ok: true, summary: expect.stringContaining("0 scheduled tasks") });
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

  it("builds exactly the page test's fixture (apps/web/src/mcp-app/week-result.fixture.json)", async () => {
    const outcome = await runScreen("showWeek", {}, fakeServices(), ctx);
    if (!outcome.ok) throw new Error(outcome.error);
    const fixture = JSON.parse(readFileSync(new URL("../../../../apps/web/src/mcp-app/week-result.fixture.json", import.meta.url), "utf8"));
    expect(fixture).toEqual({ content: [{ type: "text", text: outcome.summary }], structuredContent: { messages: outcome.messages } });
  });
});
