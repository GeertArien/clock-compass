import { describe, expect, it } from "vitest";
import {
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  Catalog,
  MessageProcessor,
  NodeResolver,
  STRICT_VALIDATION,
  ResolvedBinding,
  isComponentNode,
  isWritable,
  peekValue,
  type ComponentApi,
  type ComponentNode,
  type SurfaceModel,
} from "@a2ui/web_core/v1_0";
import { ccApiCatalog } from "./catalog";
import { acceptFinalEnvelopeKeys, type A2uiMessage } from "./compat";
import { specExample, weekPlan } from "./fixtures";

/** The published basic catalog as APIs only, so the spec's own example validates. */
const basicApiCatalog = new Catalog<ComponentApi>(
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
  "1.0",
  [...BASIC_COMPONENTS],
  BASIC_FUNCTIONS,
);

const ROCKS = ["task_rock_1", "task_rock_2", "task_rock_3"];

function load(messages: A2uiMessage[], options: { strict?: boolean } = {}) {
  const processor = new MessageProcessor<ComponentApi>(
    [ccApiCatalog, basicApiCatalog],
    undefined,
    options.strict ? { validationConfig: STRICT_VALIDATION } : undefined,
  );
  let surface: SurfaceModel<ComponentApi> | undefined;
  processor.onSurfaceCreated((s) => (surface = s));
  processor.processMessages(messages as never);
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

describe("A2UI 1.0 on @a2ui/web_core with the assistant catalog", () => {
  it("resolves the week plan: one TaskCard per data-model row", () => {
    const { root } = load(acceptFinalEnvelopeKeys(weekPlan(ROCKS, "2026-W47")));
    expect(root.type).toBe("Column");
    const cards = findAll(root, "rock");
    expect(cards.map((c) => c.type)).toEqual(["TaskCard", "TaskCard", "TaskCard"]);
    expect(cards.map((c) => props(c).taskId)).toEqual(ROCKS);
    expect(props(first(root, "summary")).text).toBe(
      "3 rocks proposed for 2026-W47. Edit any of them before you accept.",
    );
  });

  it("keeps the ConfirmBar invalid until its check passes, then sends a resolved action", async () => {
    const { surface, root } = load(acceptFinalEnvelopeKeys(weekPlan(ROCKS, "2026-W47")));
    const sent: unknown[] = [];
    surface.onAction.subscribe((action) => void sent.push(action));

    expect(props(first(root, "confirm")).isValid).toBe(false);
    expect(props(first(root, "note")).validationErrors).toEqual([
      "Add an intention before you accept the plan.",
    ]);

    // Typing in the bound TextField writes to the surface's data model…
    (props(first(root, "note")).setValue as (next: string) => void)("Be present at dinner");

    // …which re-evaluates the checks on both components.
    expect(props(first(root, "note")).validationErrors).toEqual([]);
    const confirm = props(first(root, "confirm"));
    expect(confirm.isValid).toBe(true);

    await (confirm.confirm as () => Promise<void>)();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      name: "acceptWeekPlan",
      surfaceId: "week_plan",
      sourceComponentId: "confirm",
      userMessage: "Accepted the proposed week",
      context: { week: "2026-W47", note: "Be present at dinner" },
    });
  });

  it("re-renders the list when the data model changes", () => {
    const { surface, root } = load(acceptFinalEnvelopeKeys(weekPlan(ROCKS, "2026-W47")));
    surface.dataModel.set("/rocks", [{ id: "task_rock_9" }]);
    const resolved = peekValue(new NodeResolver(surface).rootNode)!;
    expect(findAll(resolved, "rock").map((c) => props(c).taskId)).toEqual(["task_rock_9"]);
    expect(root.type).toBe("Column");
  });

  it("renders the spec's own example stream", () => {
    const { root } = load(acceptFinalEnvelopeKeys(specExample));
    expect(root.type).toBe("Card");
    expect(props(first(root, "first_name_field")).value).toBe("John");
  });

  it("rejects a property the catalog does not allow, naming the component", () => {
    const bad = weekPlan(ROCKS, "2026-W47");
    const update = bad[1]!.updateComponents as { components: Record<string, unknown>[] };
    update.components.find((c) => c.id === "title")!.variant = "h2";
    expect(() => load(acceptFinalEnvelopeKeys(bad))).toThrow(/Text.*title.*variant/s);
  });

  it("rejects a component type outside the catalog under strict validation (what the server will use)", () => {
    const bad = weekPlan(ROCKS, "2026-W47");
    const update = bad[1]!.updateComponents as { components: Record<string, unknown>[] };
    update.components.find((c) => c.id === "rock")!.component = "DeleteEverything";
    // Default (streaming) rules tolerate it; the renderer draws nothing for it.
    expect(() => load(acceptFinalEnvelopeKeys(bad))).not.toThrow();
    expect(() => load(acceptFinalEnvelopeKeys(bad), { strict: true })).toThrow(/DeleteEverything/);
  });

  it("accepts the complete week plan under strict validation", () => {
    expect(() =>
      load(acceptFinalEnvelopeKeys(weekPlan(ROCKS, "2026-W47")), { strict: true }),
    ).not.toThrow();
  });
});

describe("compat shim for web_core 0.15.0", () => {
  it("is still needed: the core rejects the final `@checks` envelope key", () => {
    // When this starts failing, the core reads the final keys itself:
    // delete compat.ts and rename `checks` to `@checks` in catalog.ts.
    expect(() => load(weekPlan(ROCKS, "2026-W47"))).toThrow(/@checks/);
  });

  it("only touches envelope keys at the component root", () => {
    const [, update] = acceptFinalEnvelopeKeys(weekPlan(ROCKS, "2026-W47"));
    const components = (update!.updateComponents as { components: Record<string, unknown>[] })
      .components;
    const note = components.find((c) => c.id === "note")!;
    expect(note).toHaveProperty("checks");
    expect(note).not.toHaveProperty("@checks");
    expect(note.value).toEqual({ "@path": "/note" });
  });
});
