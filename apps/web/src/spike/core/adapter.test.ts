import { describe, expect, it } from "vitest";
import {
  MessageProcessor,
  NodeResolver,
  isComponentNode,
  peekValue,
  type ComponentApi,
  type ComponentNode,
  type SurfaceModel,
} from "@a2ui/web_core/v1_0";
import { specExample, weekPlan } from "../fixtures";
import { basicApiCatalog, ccCatalog } from "./catalog";
import { acceptFinalEnvelopeKeys, type A2uiMessage } from "./compat";
import { unwrapProps } from "./props";

function load(messages: A2uiMessage[]) {
  const processor = new MessageProcessor<ComponentApi>([ccCatalog, basicApiCatalog]);
  let surface: SurfaceModel<ComponentApi> | undefined;
  processor.onSurfaceCreated((s) => (surface = s));
  processor.processMessages(messages as never);
  if (!surface) throw new Error("no surface created");
  const resolver = new NodeResolver(surface);
  const root = peekValue(resolver.rootNode);
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

const props = (node: ComponentNode) => unwrapProps(peekValue(node.props));

describe("A2UI 1.0 on @a2ui/web_core with our catalog", () => {
  it("resolves the week plan: one live TaskCard per data-model row", () => {
    const { root } = load(acceptFinalEnvelopeKeys(weekPlan));
    expect(root.type).toBe("Column");
    const cards = findAll(root, "rock");
    expect(cards.map((c) => c.type)).toEqual(["TaskCard", "TaskCard", "TaskCard"]);
    expect(cards.map((c) => props(c).taskId)).toEqual(["task_rock_1", "task_rock_2", "task_rock_3"]);
    expect(props(findAll(root, "summary")[0]!).text).toBe(
      "3 rocks proposed for 2026-W47. Toggle or edit any of them.",
    );
  });

  it("keeps the ConfirmBar disabled until its check passes, then sends a resolved action", async () => {
    const { surface, root } = load(acceptFinalEnvelopeKeys(weekPlan));
    const sent: unknown[] = [];
    surface.onAction.subscribe((action) => void sent.push(action));

    expect(props(findAll(root, "confirm")[0]!).isValid).toBe(false);

    // Typing in the bound TextField writes to the surface's data model…
    const setValue = props(findAll(root, "note")[0]!).setValue as (next: string) => void;
    setValue("Be present at dinner");

    // …which re-evaluates the check on the ConfirmBar.
    const confirm = props(findAll(root, "confirm")[0]!);
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

  it("renders the spec's own example stream", () => {
    const { root } = load(acceptFinalEnvelopeKeys(specExample));
    expect(root.type).toBe("Card");
    expect(props(findAll(root, "first_name_field")[0]!).value).toBe("John");
  });

  it("rejects a component the catalog does not allow, naming the problem", () => {
    const bad = structuredClone(weekPlan);
    const update = bad[1]!.updateComponents as { components: Record<string, unknown>[] };
    update.components.find((c) => c.id === "title")!.variant = "h2";
    expect(() => load(acceptFinalEnvelopeKeys(bad))).toThrow(/Text.*title.*variant/s);
  });
});

describe("compat shim for web_core 0.15.0", () => {
  it("is still needed: the core rejects the final `@checks` envelope key", () => {
    // When this starts failing, the core reads the final keys itself:
    // delete compat.ts and rename `checks` to `@checks` in catalog.ts.
    expect(() => load(weekPlan)).toThrow(/@checks/);
  });

  it("only touches envelope keys at the component root", () => {
    const [, update] = acceptFinalEnvelopeKeys(weekPlan);
    const components = (update!.updateComponents as { components: Record<string, unknown>[] })
      .components;
    const note = components.find((c) => c.id === "note")!;
    expect(note).toHaveProperty("checks");
    expect(note).not.toHaveProperty("@checks");
    expect(note.value).toEqual({ "@path": "/note" });
  });
});
