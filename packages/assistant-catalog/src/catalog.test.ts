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

  it("keeps the ConfirmBar invalid until its check passes, then sends the resolved action", async () => {
    const { surface, root } = load(weekPlan(ROCKS, WEEK));
    const sent: unknown[] = [];
    surface.onAction.subscribe((action) => void sent.push(action));

    expect(props(first(root, "confirm")).isValid).toBe(false);
    expect(props(first(root, "intention")).validationErrors).toEqual([
      "Add an intention before you accept the plan.",
    ]);

    (props(first(root, "intention")).setValue as (next: string) => void)("Be present at dinner");

    expect(props(first(root, "intention")).validationErrors).toEqual([]);
    const confirm = props(first(root, "confirm"));
    expect(confirm.isValid).toBe(true);

    await (confirm.confirm as () => Promise<void>)();
    expect(sent).toEqual([
      expect.objectContaining({
        name: "acceptWeekPlan",
        surfaceId: "week_plan",
        sourceComponentId: "confirm",
        userMessage: "Accepted the proposed week",
        context: { weekStart: WEEK, taskIds: ROCKS, intention: "Be present at dinner" },
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

  it("allows non-write events (e.g. Not now) from any button", () => {
    const payload = withComponent(weekPlan(ROCKS, WEEK), "confirm", (c) => {
      c.dismiss = { event: { name: "dismissWeekPlan" } };
    });
    expect(validatePayload(payload)).toEqual({ ok: true });
  });
});

describe("describeCatalog", () => {
  it("lists every component, the instructions and the confirmable actions", () => {
    const text = describeCatalog();
    for (const name of ["TaskCard", "QuadrantBoard", "GoalList", "HabitCheckIn", "Chart", "ConfirmBar", "Column", "TextField"]) {
      expect(text).toContain(`"${name}"`);
    }
    expect(text).toContain("clock-compass:assistant/v1");
    expect(text).toMatch(/- acceptWeekPlan \(week\):/);
    expect(text).toMatch(/taskIds: The big rocks/);
  });
});

describe("compat shim for web_core 0.15.0", () => {
  it("is still needed: the core rejects the final `@checks` envelope key", () => {
    // When this starts failing, the core reads the final keys itself:
    // delete compat.ts and rename `checks` to `@checks` in components.ts.
    const processor = new MessageProcessor<ComponentApi>([ccApiCatalog]);
    expect(() => processor.processMessages(weekPlan(ROCKS, WEEK) as never)).toThrow(/@checks/);
  });

  it("only touches envelope keys at the component root", () => {
    const [, update] = acceptFinalEnvelopeKeys(weekPlan(ROCKS, WEEK));
    const components = (update!.updateComponents as { components: Record<string, unknown>[] }).components;
    const field = components.find((c) => c.id === "intention")!;
    expect(field).toHaveProperty("checks");
    expect(field).not.toHaveProperty("@checks");
    expect(field.value).toEqual({ "@path": "/intention" });
  });
});
