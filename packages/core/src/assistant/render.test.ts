import { describe, expect, it } from "vitest";
import { CC_CATALOG_ID } from "@clock-compass/assistant-catalog";
import { goalsReview, weekPlan } from "@clock-compass/assistant-catalog/fixtures";
import { RENDER_TOOL, renderInstructions, renderSurface } from "./render.js";

/** A fixture's components and data, as the model sends them to render_a2ui. */
function argsOf(messages: Record<string, unknown>[]) {
  const components = messages.flatMap((m) => (m.updateComponents as { components?: unknown[] } | undefined)?.components ?? []);
  const data = messages.map((m) => (m.updateDataModel as { value?: unknown } | undefined)?.value).find(Boolean);
  return { surfaceId: "goals", components, ...(data ? { data } : {}) };
}

describe("renderSurface", () => {
  it("turns valid arguments into a complete A2UI 1.0 surface in our catalog", () => {
    const args = argsOf(goalsReview(["g1"], [{ label: "Garden", value: 2 }]));
    const outcome = renderSurface(args);
    expect(outcome).toMatchObject({ ok: true, surfaceId: "goals" });
    if (!outcome.ok) return;
    expect(outcome.messages[0]).toEqual({ version: "1.0", createSurface: { surfaceId: "goals", catalogId: CC_CATALOG_ID } });
    expect(outcome.messages[1]).toEqual({ version: "1.0", updateComponents: { surfaceId: "goals", components: args.components } });
    expect(outcome.messages[2]).toMatchObject({ version: "1.0", updateDataModel: { surfaceId: "goals" } });
  });

  it("reports what is wrong, never throwing, for anything the model might send", () => {
    const bad: unknown[] = [
      undefined,
      "a string",
      { surfaceId: "x" },
      { surfaceId: "has spaces", components: [{ id: "root", component: "Text", text: "hi" }] },
      { surfaceId: "x", components: [{ id: "root", component: "Marquee", text: "hi" }] },
      { surfaceId: "x", components: [{ id: "notroot", component: "Text", text: "hi" }] },
      { surfaceId: "x", components: [{ id: "root", component: "Text", text: { path: "/bare" } }] },
      { surfaceId: "x", components: [{ id: "root", component: "Text", text: "hi" }], extra: 1 },
    ];
    for (const args of bad) {
      const outcome = renderSurface(args);
      expect(outcome.ok, JSON.stringify(args)).toBe(false);
      if (!outcome.ok) expect(outcome.errors.length).toBeGreaterThan(0);
    }
    const cyclic: Record<string, unknown> = { surfaceId: "x" };
    cyclic.components = [cyclic];
    expect(renderSurface(cyclic)).toEqual({ ok: false, errors: ["The arguments must be plain JSON."] });
  });

  it("refuses an oversized screen", () => {
    const text = "x".repeat(2000);
    const components = [
      { id: "root", component: "Column", children: Array.from({ length: 60 }, (_, i) => `t${i}`) },
      ...Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, component: "Text", text })),
    ];
    expect(renderSurface({ surfaceId: "big", components })).toEqual({
      ok: false,
      errors: [expect.stringMatching(/too large/)],
    });
  });

  it("refuses a ConfirmBar until confirmed actions exist (step 6), and accepts it when they do", () => {
    const args = { ...argsOf(weekPlan(["t1"], "2026-11-23")), surfaceId: "week_plan" };
    expect(renderSurface(args)).toEqual({ ok: false, errors: [expect.stringMatching(/ConfirmBar is not available yet/)] });
    expect(renderSurface(args, { confirmations: true })).toMatchObject({ ok: true });
  });
});

describe("proposals that clear something (#109)", () => {
  const bar = (name: string, context: Record<string, unknown>) => ({
    surfaceId: "clear",
    components: [
      { id: "root", component: "Column", children: ["card", "confirm"] },
      { id: "card", component: "TaskCard", taskId: "t1" },
      { id: "confirm", component: "ConfirmBar", confirm: { event: { name, context } }, dismiss: { event: { name: "notNow" } } },
    ],
  });

  it.each([
    ["updateTask", { taskId: "t1", projectId: null }],
    ["updateTask", { taskId: "t1", dueDate: null, goalId: null, notes: null, proactivity: null }],
    ["scheduleTask", { taskId: "t1", day: null }],
    ["scheduleTask", { taskId: "t1", day: "2026-11-24", time: null }],
  ])("shows %s %j: a literal null in the arguments is allowed", (name, context) => {
    expect(renderSurface(bar(name, context), { confirmations: true })).toMatchObject({ ok: true });
  });
});

describe("surface ids", () => {
  it("appends the server's suffix to the surface id in every message, within 64 characters", () => {
    const outcome = renderSurface(argsOf(goalsReview(["g1"], [{ label: "Garden", value: 2 }])), { idSuffix: "a1b2c3d4" });
    expect(outcome).toMatchObject({ ok: true, surfaceId: "goals-a1b2c3d4" });
    if (!outcome.ok) return;
    for (const message of outcome.messages) {
      const body = Object.values(message).find((v) => typeof v === "object") as { surfaceId: string };
      expect(body.surfaceId).toBe("goals-a1b2c3d4");
    }
    const long = renderSurface(
      { surfaceId: "x".repeat(64), components: [{ id: "root", component: "Text", text: "hi" }] },
      { idSuffix: "a1b2c3d4" },
    );
    expect(long.ok && long.surfaceId.length).toBe(64);
    expect(long.ok && long.surfaceId.endsWith("-a1b2c3d4")).toBe(true);
  });
});

describe("the render tool and its instructions", () => {
  it("has the AG-UI A2UI middleware's name and argument shape", () => {
    expect(RENDER_TOOL.name).toBe("render_a2ui");
    expect(RENDER_TOOL.inputSchema).toMatchObject({ required: ["surfaceId", "components"] });
  });

  it("includes the catalog, and the confirm rule that matches the options", () => {
    const text = renderInstructions();
    expect(text).toContain(CC_CATALOG_ID);
    expect(text).toContain("QuadrantBoard");
    expect(text).toMatch(/do not use ConfirmBar/);
    // The only mention: no schema, no "end every proposal with one", no action list.
    expect(text.match(/ConfirmBar/g)).toHaveLength(1);
    expect(text).not.toMatch(/acceptWeekPlan|end every proposal/);
    expect(renderInstructions({ confirmations: true })).toMatch(/ends with a ConfirmBar/);
    // The model is told the buttons' fixed names, and that the line above them is the app's.
    expect(renderInstructions({ confirmations: true })).toMatch(/always read “Confirm” and “Not now”.*written by the app/);
    expect(renderInstructions({ confirmations: false })).not.toMatch(/“Confirm”/);
    // Text in a proposal says what would happen, never that it happened (#145).
    expect(renderInstructions({ confirmations: true })).toMatch(/Word any text in a proposal as what would happen, never as done/);
  });
});
