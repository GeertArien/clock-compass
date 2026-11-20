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
    expect(renderInstructions({ confirmations: true })).toMatch(/ends with a ConfirmBar/);
  });
});
