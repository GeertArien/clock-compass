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
    expect(outcome.summary).toBe("Shown: the week of 2026-11-16, 1 big rock (0 done), 1 scheduled task.");
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
});
