import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  Catalog,
  MessageProcessor,
  NodeResolver,
  ResolvedBinding,
  isComponentNode,
  isWritable,
  peekValue,
  type ComponentApi,
  type ComponentNode,
  type SurfaceModel,
} from "@a2ui/web_core/v1_0";
import { ccApiCatalog, describeCatalog, validatePayload } from "./catalog";
import { acceptFinalEnvelopeKeys, type A2uiMessage } from "./compat";
import { ChartBarsSchema } from "./components";
import { goalsReview, habitCheckIn, matrixView, scheduleProposal, weekPlan } from "./fixtures";

/** The "Example Stream" from the v1.0 protocol spec, verbatim (contact form). */
const specExample: A2uiMessage[] = readFileSync(new URL("./spec-example.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as A2uiMessage);

/** The published basic catalog as APIs only, so the spec's own example validates. */
const basicApiCatalog = new Catalog<ComponentApi>(
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
  "1.0",
  [...BASIC_COMPONENTS],
  BASIC_FUNCTIONS,
);

const ROCKS = ["task_rock_1", "task_rock_2", "task_rock_3"];
const WEEK = "2026-11-16";

function load(messages: A2uiMessage[]) {
  const processor = new MessageProcessor<ComponentApi>([ccApiCatalog, basicApiCatalog]);
  let surface: SurfaceModel<ComponentApi> | undefined;
  processor.onSurfaceCreated((s) => (surface = s));
  processor.processMessages(acceptFinalEnvelopeKeys(messages) as never);
  if (!surface) throw new Error("no surface created");
  const root = peekValue(new NodeResolver(surface).rootNode);
  if (!root) throw new Error("no root node");
  return { surface, root };
}

/** Depth-first search of the resolved tree by component id. */
function findAll(node: ComponentNode, componentId: string): ComponentNode[] {
  const hits = node.componentId === componentId ? [node] : [];
  for (const value of Object.values(peekValue(node.props))) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (isComponentNode(child)) hits.push(...findAll(child, componentId));
    }
  }
  return hits;
}

/** A node's props as a view sees them: bindings become a value plus a setter. */
function props(node: ComponentNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(peekValue(node.props))) {
    if (value instanceof ResolvedBinding) {
      out[key] = value.value;
      if (isWritable(value)) out[`set${key[0]!.toUpperCase()}${key.slice(1)}`] = value.set;
    } else {
      out[key] = value;
    }
  }
  return out;
}

const first = (root: ComponentNode, id: string) => findAll(root, id)[0]!;

/** A copy of a fixture with one component changed. */
function withComponent(
  messages: A2uiMessage[],
  id: string,
  change: (c: Record<string, unknown>) => void,
): A2uiMessage[] {
  const copy = structuredClone(messages);
  const update = copy.find((m) => "updateComponents" in m)!.updateComponents as {
    components: Record<string, unknown>[];
  };
  change(update.components.find((c) => c.id === id)!);
  return copy;
}

describe("the week plan on the official core", () => {
  it("resolves one TaskCard per data-model row and the formatted summary", () => {
    const { root } = load(weekPlan(ROCKS, WEEK));
    expect(root.type).toBe("Column");
    const cards = findAll(root, "rock");
    expect(cards.map((c) => c.type)).toEqual(["TaskCard", "TaskCard", "TaskCard"]);
    expect(cards.map((c) => props(c).taskId)).toEqual(ROCKS);
    expect(props(first(root, "summary")).text).toBe(
      "3 rocks proposed for the week of 2026-11-16. Edit any of them before you accept.",
    );
  });

  it("sends the week plan's accept as acceptWeekPlan with the resolved arguments", async () => {
    const { surface, root } = load(weekPlan(ROCKS, WEEK));
    const sent: unknown[] = [];
    surface.onAction.subscribe((action) => void sent.push(action));
    await (props(first(root, "confirm")).confirm as () => Promise<void>)();
    expect(sent).toEqual([
      expect.objectContaining({
        name: "acceptWeekPlan",
        surfaceId: "week_plan",
        sourceComponentId: "confirm",
        userMessage: "Accepted the proposed week",
        context: { weekStart: WEEK, taskIds: ROCKS },
      }),
    ]);
  });

  it("re-renders the list when the data model changes", () => {
    const { surface } = load(weekPlan(ROCKS, WEEK));
    surface.dataModel.set("/rocks", [{ id: "task_rock_9" }]);
    const resolved = peekValue(new NodeResolver(surface).rootNode)!;
    expect(findAll(resolved, "rock").map((c) => props(c).taskId)).toEqual(["task_rock_9"]);
  });

  it("renders the spec's own example stream", () => {
    const { root } = load(specExample);
    expect(root.type).toBe("Card");
    expect(props(first(root, "first_name_field")).value).toBe("John");
  });
});

describe("the schedule proposal: a bound field with checks", () => {
  it("keeps the ConfirmBar invalid while the day fails its checks, then sends the edited day", async () => {
    const { surface, root } = load(scheduleProposal("t1", "2026-11-21"));
    const sent: unknown[] = [];
    surface.onAction.subscribe((action) => void sent.push(action));
    const setDay = (value: string) => (props(first(root, "day")).setValue as (next: string) => void)(value);

    expect(props(first(root, "confirm")).isValid).toBe(true);
    setDay("");
    expect(props(first(root, "confirm")).isValid).toBe(false);
    expect(props(first(root, "day")).validationErrors).toEqual(["Pick a day.", "Write the day as YYYY-MM-DD."]);
    setDay("next friday");
    expect(props(first(root, "day")).validationErrors).toEqual(["Write the day as YYYY-MM-DD."]);
    setDay("2026-11-27");
    expect(props(first(root, "day")).validationErrors).toEqual([]);

    const confirm = props(first(root, "confirm"));
    expect(confirm.isValid).toBe(true);
    await (confirm.confirm as () => Promise<void>)();
    expect(sent).toEqual([
      expect.objectContaining({ name: "scheduleTask", context: { taskId: "t1", day: "2026-11-27" } }),
    ]);
  });
});

describe("the app components", () => {
  it("QuadrantBoard: ids are optional (all open tasks) or a literal list", () => {
    expect(props(first(load(matrixView()).root, "board")).taskIds).toBeUndefined();
    expect(props(first(load(matrixView(["a", "b"])).root, "board")).taskIds).toEqual(["a", "b"]);
  });

  it("GoalList and Chart: the chart's bars resolve from the data model", () => {
    const bars = [
      { label: "Parent", value: 6 },
      { label: "Professional", value: 9 },
    ];
    const { root } = load(goalsReview(["g1"], bars));
    expect(props(first(root, "goals")).goalIds).toEqual(["g1"]);
    expect(props(first(root, "chart")).bars).toEqual(bars);
    expect(ChartBarsSchema.safeParse(bars).success).toBe(true);
  });

  it("HabitCheckIn: ids are optional", () => {
    expect(props(first(load(habitCheckIn(["h1"])).root, "habits")).habitIds).toEqual(["h1"]);
  });

  it("Chart bars must be 1–24 labelled, non-negative numbers", () => {
    expect(ChartBarsSchema.safeParse([]).success).toBe(false);
    expect(ChartBarsSchema.safeParse([{ label: "x", value: -1 }]).success).toBe(false);
    expect(ChartBarsSchema.safeParse([{ label: "", value: 1 }]).success).toBe(false);
    expect(ChartBarsSchema.safeParse([{ label: "x", value: 1, color: "red" }]).success).toBe(false);
  });
});

describe("validatePayload (what the server will run on model output)", () => {
  it.each([
    ["weekPlan", weekPlan(ROCKS, WEEK)],
    ["matrixView", matrixView()],
    ["goalsReview", goalsReview(undefined, [{ label: "Parent", value: 3 }])],
    ["habitCheckIn", habitCheckIn()],
    ["scheduleProposal", scheduleProposal("t1", "2026-11-21")],
  ])("accepts the %s fixture", (_name, messages) => {
    expect(validatePayload(messages)).toEqual({ ok: true });
  });

  it.each([
    ["an unknown property", "title", (c: Record<string, unknown>) => (c.variant = "h2"), /title.*variant/s],
    ["a component outside the catalog", "rock", (c: Record<string, unknown>) => (c.component = "DeleteEverything"), /DeleteEverything/],
    ["a TaskCard without a taskId", "rock", (c: Record<string, unknown>) => delete c.taskId, /taskId/],
    ["a ConfirmBar without a confirm", "confirm", (c: Record<string, unknown>) => delete c.confirm, /confirm/],
    ["a dangling child", "root", (c: Record<string, unknown>) => (c.children = ["title", "nowhere"]), /nowhere/],
  ])("rejects %s, naming it", (_name, id, change, pattern) => {
    const result = validatePayload(withComponent(weekPlan(ROCKS, WEEK), id, change));
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("\n")).toMatch(pattern);
  });

  it("rejects a Chart with props outside its schema", () => {
    const bad = withComponent(goalsReview(undefined, [{ label: "x", value: 1 }]), "chart", (c) => (c.max = -5));
    expect(validatePayload(bad).ok).toBe(false);
  });

  it("rejects a confirmable action anywhere but a ConfirmBar's confirm", () => {
    const sneaky = withComponent(weekPlan(ROCKS, WEEK), "confirm", (c) => {
      c.dismiss = { event: { name: "setTaskDone", context: { taskId: "t1", done: true } } };
    });
    const result = validatePayload(sneaky);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("\n")).toMatch(/ConfirmBar "confirm" sends "setTaskDone" from "dismiss"/);

    const button = structuredClone(matrixView());
    (button[1]!.updateComponents as { components: Record<string, unknown>[] }).components.push(
      { id: "label", component: "Text", text: "Done" },
      { id: "go", component: "Button", child: "label", action: { event: { name: "setBigRock", context: {} } } },
    );
    ((button[1]!.updateComponents as { components: Record<string, unknown>[] }).components[0]!.children as string[]).push("go");
    expect(validatePayload(button)).toMatchObject({ ok: false, errors: [expect.stringMatching(/Button "go"/)] });
  });

  it.each([
    ["an object instead of an array", { version: "1.0" }],
    ["a null message", [null]],
    ["a string message", ["createSurface"]],
    ["components that are not an array", [{ version: "1.0", updateComponents: { surfaceId: "s", components: { id: "root" } } }]],
    ["a null component", [{ version: "1.0", updateComponents: { surfaceId: "s", components: [null] } }]],
  ])("reports %s without throwing", (_name, payload) => {
    let result: ReturnType<typeof validatePayload> | undefined;
    expect(() => (result = validatePayload(payload))).not.toThrow();
    expect(result!.ok).toBe(false);
  });

  it.each([
    ["a bare path binding", (c: Record<string, unknown>) => (c.text = { path: "/weekStart" }), /title.*binds with "path"; write \{"@path"/s],
    [
      "a bare call",
      (c: Record<string, unknown>) => (c.text = { call: "formatString", args: { value: "x" } }),
      /title.*calls "formatString" with "call"/s,
    ],
  ])("rejects %s (pre-final keys the renderer cannot read), naming the fix", (_name, change, pattern) => {
    const result = validatePayload(withComponent(weekPlan(ROCKS, WEEK), "title", change));
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("\n")).toMatch(pattern);
  });

  it("rejects a function outside the catalog behind a bare call (openUrl)", () => {
    const button = structuredClone(matrixView());
    const update = button[1]!.updateComponents as { components: Record<string, unknown>[] };
    update.components.push(
      { id: "label", component: "Text", text: "Open" },
      { id: "go", component: "Button", child: "label", action: { functionCall: { call: "openUrl", args: { url: "https://example.com" } } } },
    );
    (update.components[0]!.children as string[]).push("go");
    const result = validatePayload(button);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.errors.join("\n")).toMatch(/openUrl/);
  });

  it("keeps @path bindings and a List template's path valid", () => {
    // weekPlan has both: {"@path": …} bindings and children: {componentId, path}.
    expect(validatePayload(weekPlan(ROCKS, WEEK))).toEqual({ ok: true });
  });

  it("allows non-write events (e.g. Not now) from any button", () => {
    const payload = withComponent(weekPlan(ROCKS, WEEK), "confirm", (c) => {
      c.dismiss = { event: { name: "dismissWeekPlan" } };
    });
    expect(validatePayload(payload)).toEqual({ ok: true });
  });
});

describe("describeCatalog", () => {
  it("defines every shared definition the catalog refers to, with the final binding keys", () => {
    const text = describeCatalog();
    const refs = new Set([...text.matchAll(/common_types\.json#\/\$defs\/(\w+)/g)].map((m) => m[1]!));
    expect(refs.size).toBeGreaterThan(5);
    const defsLine = text.split("\n").find((line) => line.startsWith('{"$defs"'))!;
    const defs = Object.keys((JSON.parse(defsLine) as { $defs: Record<string, unknown> }).$defs);
    for (const ref of refs) expect(defs, ref).toContain(ref);
    expect(text).toContain('"@path"');
    expect(text).toContain('"@call"');
  });

  it("shows one spelling of the checks key: the final @checks", () => {
    const text = describeCatalog();
    expect(text).toContain('"@checks"');
    expect(text).not.toMatch(/"checks"\s*:/);
  });

  it("lists every component, the instructions and the confirmable actions", () => {
    const text = describeCatalog();
    for (const name of ["TaskCard", "QuadrantBoard", "GoalList", "HabitCheckIn", "Chart", "ConfirmBar", "Column", "TextField"]) {
      expect(text).toContain(`"${name}"`);
    }
    expect(text).toContain("clock-compass:assistant/v1");
    expect(text).toMatch(/- acceptWeekPlan \(week\):/);
    expect(text).toMatch(/taskIds: The big rocks/);
    expect(text).not.toMatch(/intention/);
  });

  it("leaves the ConfirmBar, its instruction and the actions out while confirmations are off", () => {
    const text = describeCatalog({ confirmations: false });
    expect(text).not.toContain("ConfirmBar");
    expect(text).not.toMatch(/acceptWeekPlan|setTaskDone|end every proposal/);
    for (const name of ["TaskCard", "QuadrantBoard", "GoalList", "HabitCheckIn", "Chart", "Column"]) {
      expect(text).toContain(`"${name}"`);
    }
    expect(describeCatalog().length).toBeGreaterThan(text.length);
  });
});

describe("compat shim for web_core 0.15.0", () => {
  it("is still needed: the core rejects the final `@checks` envelope key", () => {
    // When this starts failing, the core reads the final keys itself:
    // delete compat.ts and rename `checks` to `@checks` in components.ts.
    const processor = new MessageProcessor<ComponentApi>([ccApiCatalog]);
    expect(() => processor.processMessages(scheduleProposal("t1", "2026-11-21") as never)).toThrow(/@checks/);
  });

  it("only touches envelope keys at the component root", () => {
    const [, update] = acceptFinalEnvelopeKeys(scheduleProposal("t1", "2026-11-21"));
    const components = (update!.updateComponents as { components: Record<string, unknown>[] }).components;
    const field = components.find((c) => c.id === "day")!;
    expect(field).toHaveProperty("checks");
    expect(field).not.toHaveProperty("@checks");
    expect(field.value).toEqual({ "@path": "/day" });
  });
});
