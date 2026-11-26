// @vitest-environment happy-dom
/**
 * The MCP App page (#118) against a stand-in host: the SDK's own AppBridge,
 * linked to the page's App in memory, sends what a host would send. It runs
 * twice: with the host side at ext-apps 1.7.5 (the version the page is built
 * with) and at 2.0.4 (the version Open WebUI hosts pages with), so the two
 * versions of the page protocol are checked against each other.
 * The tool results are real `show_week`, `show_matrix`, `show_habits` and
 * `propose_changes` answers (the fixtures; core's tests check they are exactly what the server
 * builds). No real host has drawn the page yet (#149): these stand-in hosts
 * are all that checks it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge as AppBridgeV1 } from "@modelcontextprotocol/ext-apps/app-bridge";
import { AppBridge as AppBridgeV2 } from "ext-apps-v2/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { habitsQuery } from "@/lib/queries/renewal";
import { createPageQueryClient, refreshReads } from "./data";
import { startPage } from "./page";
import week from "./week-result.fixture.json";
import matrix from "./matrix-result.fixture.json";
import habits from "./habits-result.fixture.json";
import proposal from "./proposal-result.fixture.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ToolResult = Parameters<AppBridgeV1["sendToolResult"]>[0];
/** The parts of a host bridge the tests use, the same in both versions. */
interface Bridge {
  oninitialized?: () => void;
  oncalltool?: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  connect(transport: unknown): Promise<void>;
  sendToolResult(result: ToolResult): Promise<void>;
  setHostContext(context: { theme: "light" | "dark" }): void;
}
/** What the stand-in host offers the page: server tool calls, and model-context updates (step 3). */
const HOST_CAPABILITIES = { serverTools: {}, updateModelContext: { text: {} } };
type Capabilities = Partial<typeof HOST_CAPABILITIES>;
const BRIDGES: [string, (capabilities?: Capabilities) => Bridge][] = [
  ["ext-apps 1.7.5", (c = HOST_CAPABILITIES) => new AppBridgeV1(null, { name: "stand-in host", version: "0" }, c, { hostContext: { theme } }) as unknown as Bridge],
  ["ext-apps 2.0.4 (Open WebUI's)", (c = HOST_CAPABILITIES) => new AppBridgeV2(null, { name: "stand-in host", version: "0" }, c, { hostContext: { theme } }) as unknown as Bridge],
];
let theme: "light" | "dark" = "light";

async function host(t: "light" | "dark", make: () => Bridge) {
  theme = t;
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const [hostSide, pageSide] = InMemoryTransport.createLinkedPair();
  const bridge = make();
  const initialized = new Promise<void>((resolve) => (bridge.oninitialized = () => resolve()));
  await bridge.connect(hostSide);
  const app = new App({ name: "Clock & Compass", version: "1.0.0" });
  await act(async () => {
    await startPage(root, app, pageSide);
    await initialized;
  });
  const send = async (result: ToolResult) =>
    act(async () => {
      await bridge.sendToolResult(result);
      await new Promise((r) => setTimeout(r, 0));
    });
  return { root, bridge, send, app };
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

/** Every button and select on the page: none may write in step 2. */
const controls = (root: HTMLElement) => [...root.querySelectorAll("button, select")] as (HTMLButtonElement | HTMLSelectElement)[];

describe.each(BRIDGES)("the MCP App page in a stand-in host, %s", (_name, make) => {
  it("draws the week from a show_week result", async () => {
    const { root, send } = await host("light", make);
    expect(root.textContent).toBe("Loading…");
    await send(week as ToolResult);
    const text = root.textContent ?? "";
    expect(text).toContain("Week of 16 November");
    expect(text).toContain("○ Plan the garden");
    expect(text).toContain("Saturday 2109:00 Plan the garden");
    expect(text.match(/Nothing scheduled/g)).toHaveLength(6);
  });

  it("starts in the host's theme and follows a change", async () => {
    const { bridge } = await host("dark", make);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await act(async () => {
      bridge.setHostContext({ theme: "light" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("draws the matrix with the app's own task cards from the result alone, read-only (step 2)", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { root, send } = await host("light", make);
    await send(matrix as ToolResult);
    const text = root.textContent ?? "";
    expect(text).toContain("Your tasks by quadrant");
    for (const title of ["Call the plumber", "Plan the garden", "Reply to overdue email"]) expect(text).toContain(title);
    // The quadrant grid of Compass · Matrix, and Q4 empty.
    expect(root.querySelector("[aria-label='Quadrant matrix']")).not.toBeNull();
    expect(text).toContain("Nothing here.");
    // The goal a card names comes from the result's compass read.
    expect([...root.querySelectorAll("option")].map((o) => o.textContent)).toContain("Grow our own vegetables");
    // Read-only: every control is disabled (out of the Tab order), no pencil or bin.
    expect(controls(root).length).toBeGreaterThan(0);
    expect(controls(root).every((c) => c.disabled)).toBe(true);
    expect(root.querySelector("[aria-label='Edit task'], [aria-label='Delete task']")).toBeNull();
    expect(root.querySelector("[aria-label='Big rock']")).not.toBeNull();
    // Nothing was fetched: the page has no API.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("draws the habit check-in from the result alone, read-only (step 2)", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { root, send } = await host("dark", make);
    await send(habits as ToolResult);
    const text = root.textContent ?? "";
    expect(text).toContain("Habits today");
    expect(text).toContain("Morning run");
    expect(text).toContain("2/3 wk");
    expect(controls(root).every((c) => c.disabled)).toBe(true);
    expect(root.querySelector("[aria-label='Not yet today']")).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads a screen's data again through the host, with the server's read tools (for step 3)", async () => {
    const { bridge, app } = await host("light", make);
    const calls: string[] = [];
    bridge.oncalltool = async (params) => {
      calls.push(params.name);
      const [habit] = habits.structuredContent.reads[0]!.result as { markedToday: boolean }[];
      // A list comes back as { items } from the MCP program.
      return { content: [], structuredContent: { items: [{ ...habit, markedToday: true }] } };
    };
    const client = createPageQueryClient();
    await refreshReads(app, client, habits.structuredContent.reads);
    expect(calls).toEqual(["list_habits"]);
    expect(client.getQueryData(habitsQuery.queryKey)).toEqual([expect.objectContaining({ id: "h1", markedToday: true, goalTitle: null })]);
  });

  it("shows a refused screen as its sentence", async () => {
    const { root, send } = await host("light", make);
    await send({ isError: true, content: [{ type: "text", text: "This shows data the user has not shared with AI." }] });
    expect(root.querySelector("[role=alert]")?.textContent).toBe("This shows data the user has not shared with AI.");
  });
});

/**
 * Step 3 and #159: a `propose_changes` result (the fixture is exactly what
 * core builds), edited in its cards and confirmed with a press in the page.
 * The stand-in host answers the page's tool calls as the MCP program would
 * and records them, so each test says which calls a Confirm makes through the
 * host: exactly one, the write, with or without an edit.
 */
describe.each(BRIDGES)("proposals confirmed in the page, %s (step 3, #159)", (_name, make) => {
  type Call = { name: string; arguments?: Record<string, unknown> };
  const listed = proposal.structuredContent.reads[0]!.result as { tasks: Record<string, unknown>[] };
  const t3 = listed.tasks.find((t) => t.id === "t3")!;
  const changes = proposal.structuredContent.changes;
  /** What the MCP program answers a write in the App: the result and the tasks as list_tasks shows them. */
  const written = (call: Call) =>
    call.name === "update_task"
      ? { changed: 1, tasks: [{ ...t3, ...call.arguments, proposal: undefined }] }
      : call.name === "create_task"
        ? {
            changed: 1,
            id: "k-new",
            tasks: [{ ...changes[1]!.draft, ...call.arguments, idempotencyKey: undefined, proposal: undefined, id: "k-new", quadrant: call.arguments?.urgent ? "Q1" : "Q2" }],
          }
        : { changed: 1 };

  /** A host that answers the writes, and records every call and every model-context update. */
  async function withHost(answer: (call: Call) => unknown = written, capabilities?: Capabilities) {
    const page = await host("light", () => make(capabilities));
    const calls: Call[] = [];
    const told: string[] = [];
    page.bridge.oncalltool = async (params) => {
      calls.push({ name: params.name, arguments: params.arguments });
      const out = answer(params);
      if (out === "refuse") throw new Error("The user declined this tool call.");
      return out instanceof Error ? { isError: true, content: [{ type: "text", text: out.message }] } : { content: [], structuredContent: out as Record<string, unknown> };
    };
    (page.bridge as unknown as { onupdatemodelcontext: (p: { content?: { text?: string }[] }) => Promise<object> }).onupdatemodelcontext = async (p) => {
      told.push(p.content?.[0]?.text ?? "");
      return {};
    };
    await page.send(proposal as ToolResult);
    const buttons = (label: string) => [...page.root.querySelectorAll("button")].filter((b) => b.textContent === label);
    const settle = async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };
    const press = async (button: HTMLButtonElement) =>
      act(async () => {
        button.click();
        await settle();
      });
    /** The change's card ("c0": the update, "c1": the new task). */
    const card = (n: 0 | 1) => page.root.querySelectorAll<HTMLElement>("[data-proposal-card]")[n]!;
    const inCard = (n: 0 | 1, selector: string) => card(n).querySelector(selector) as HTMLElement;
    const pill = (n: 0 | 1, label: string) => [...card(n).querySelectorAll("button")].find((b) => b.textContent?.startsWith(label))!;
    /** Types into a field the way React hears it. */
    const type = async (field: HTMLInputElement | HTMLSelectElement, value: string) =>
      act(async () => {
        const proto = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
        await settle();
      });
    return { ...page, calls, told, buttons, press, card, inCard, pill, type };
  }

  it("draws each change as the app's task card (a new task from its draft), with the sentence and a Confirm; calls nothing", async () => {
    const { root, calls, buttons, card } = await withHost();
    const text = root.textContent ?? "";
    expect(text).toContain("2 proposed changes");
    expect(text).toContain("If you confirm: Change “Call the plumber”: on 2026-11-26 at 10:00 (was not on the Clock).");
    expect(text).toContain("If you confirm: Create the task “File taxes”, important, due 2027-04-01.");
    expect(text).toContain("After you confirm");
    // The new task's card: its title, its pills, its due date.
    expect(card(1).textContent).toContain("File taxes");
    expect(card(1).textContent).toContain("Due ");
    expect(card(1).querySelector("[aria-pressed=true]")?.textContent).toBe("Important");
    expect(buttons("Confirm")).toHaveLength(2);
    expect(buttons("Confirm").every((b) => !b.disabled)).toBe(true);
    expect(calls).toEqual([]);
  });

  it("a Confirm without an edit sends the server's arguments untouched in exactly one call; the card redraws from its answer", async () => {
    const { root, calls, told, buttons, press } = await withHost();
    await press(buttons("Confirm")[0]!);
    expect(calls).toEqual([{ name: "update_task", arguments: changes[0]!.arguments }]);
    expect(root.textContent).toContain("Done.");
    // The card is the live task again, as the write answered it (no list_tasks):
    // only the new task's card is still a proposal.
    expect(root.querySelectorAll("[data-proposal-card]")).toHaveLength(1);
    expect(root.textContent).toContain("Call the plumber");
    // The conversation is told what the user confirmed (the host offers it).
    expect(told).toEqual(["The user confirmed: Change “Call the plumber”: on 2026-11-26 at 10:00 (was not on the Clock)."]);
    // A second press does nothing: the bar is locked.
    await press(buttons("Confirm")[0]!);
    expect(calls).toHaveLength(1);
  });

  it("the card's own controls and its pencil edit the proposal; Confirm sends the edited values in one call and tells the model what changed", async () => {
    const page = await withHost();
    const { root, calls, told, buttons, press, pill, inCard, type } = page;
    // The pills change the proposal, not the task: nothing is called.
    await press(pill(1, "Urgent"));
    expect(pill(1, "Urgent").getAttribute("aria-pressed")).toBe("true");
    // The pencil opens the title, the dates and the project inside the card.
    await press(inCard(1, "[aria-label='Edit the title, dates and project']") as HTMLButtonElement);
    const fields = inCard(1, "[role=group][aria-label='Edit the proposal']");
    expect(fields).not.toBeNull();
    const [title, due] = [...fields.querySelectorAll("input")] as HTMLInputElement[];
    await type(title!, "File the taxes");
    await type(due!, "2027-04-02");
    await type(fields.querySelector("select")!, "pr1");
    expect(calls).toEqual([]);
    expect(root.textContent).toContain("If you confirm: Create the task “File the taxes”, important and urgent, due 2027-04-02, in the project “Garden makeover”.");
    await press(buttons("Confirm")[1]!);
    expect(calls).toHaveLength(1);
    const { proposal: proof, idempotencyKey } = changes[1]!.arguments;
    expect(calls[0]).toEqual({
      name: "create_task",
      arguments: { title: "File the taxes", important: true, urgent: true, dueDate: "2027-04-02", projectId: "pr1", idempotencyKey, proposal: proof },
    });
    expect(root.textContent).toContain("Done: created “File the taxes”.");
    expect(told).toEqual([
      "The user confirmed, with changes: Create the task “File the taxes”, important and urgent, due 2027-04-02, in the project “Garden makeover” (id k-new). " +
        "They changed: the title “File the taxes” (you proposed the title “File taxes”); urgent (you proposed not urgent); due 2027-04-02 (you proposed due 2027-04-01); " +
        "in the project “Garden makeover” (id pr1) (you proposed in no project). Use these values, not the ones you proposed.",
    ]);
    // Once confirmed, the card is the made task, no longer editable: one pencil is left, the update's.
    expect(root.querySelectorAll("[aria-label='Edit the title, dates and project']")).toHaveLength(1);
    expect(root.querySelectorAll("[data-proposal-card]")).toHaveLength(1);
    expect(root.textContent).toContain("File the taxes");
  });

  it("edits that leave nothing to change turn Confirm off and say so", async () => {
    const { root, buttons, press, inCard, type } = await withHost();
    await press(inCard(0, "[aria-label='Edit the title, dates and project']") as HTMLButtonElement);
    // The proposal puts the task on Thursday; it is on no day now. Clearing the day leaves it as it is.
    const day = [...inCard(0, "[aria-label='Edit the proposal']").querySelectorAll("input")].find((i) => i.type === "date" && i.getAttribute("aria-labelledby"))!;
    await type(day as HTMLInputElement, "");
    expect(buttons("Confirm")[0]!.disabled).toBe(true);
    expect(root.textContent).toContain("Nothing would change: the task already has these values.");
    // An invalid edit says why, too.
    const title = inCard(0, "[aria-label='Edit the proposal'] input") as HTMLInputElement;
    await type(title, " ");
    expect(root.textContent).toContain("A task needs a title.");
    expect(buttons("Confirm")[0]!.disabled).toBe(true);
  });

  it("the host refuses the call (Cancel in its dialog): not confirmed, the edits are kept, and it can be confirmed again", async () => {
    let refuse = true;
    const page = await withHost((call) => (refuse ? "refuse" : written(call)));
    await page.press(page.pill(1, "Urgent"));
    await page.press(page.buttons("Confirm")[1]!);
    expect(page.root.querySelector("[role=alert]")?.textContent).toBe(
      "Not confirmed: this did not go through, or its answer did not arrive. Your changes to the card are kept. Press Confirm to try again; it will not happen twice.",
    );
    expect(page.told).toEqual([]);
    expect(page.pill(1, "Urgent").getAttribute("aria-pressed")).toBe("true");
    expect(page.buttons("Confirm")[1]!.disabled).toBe(false);
    refuse = false;
    await page.press(page.buttons("Confirm")[1]!);
    expect(page.calls).toHaveLength(2);
    expect(page.calls[1]!.arguments).toEqual(page.calls[0]!.arguments);
    expect(page.calls[1]!.arguments).toMatchObject({ urgent: true });
    expect(page.root.textContent).toContain("Done: created “File taxes”.");
  });

  it("without model-context updates declared by the host, nothing is sent to the model", async () => {
    const { serverTools } = HOST_CAPABILITIES;
    const { calls, told, buttons, press } = await withHost(written, { serverTools });
    await press(buttons("Confirm")[0]!);
    expect(calls.map((c) => c.name)).toEqual(["update_task"]);
    expect(told).toEqual([]);
  });

  it("a create carries the server's key; the same result drawn again and confirmed again makes nothing twice", async () => {
    let made = 0;
    const page = await withHost((call) => (call.name === "create_task" ? { ...(written(call) as object), changed: made++ === 0 ? 1 : 0 } : written(call)));
    await page.press(page.buttons("Confirm")[1]!);
    expect(page.root.textContent).toContain("Done: created “File taxes”.");
    // The host draws the page again from the same tool result (a reopened conversation).
    await page.send(proposal as ToolResult);
    await page.press(page.buttons("Confirm")[1]!);
    const creates = page.calls.filter((c) => c.name === "create_task");
    expect(creates).toHaveLength(2);
    expect(creates[0]!.arguments).toEqual(changes[1]!.arguments);
    expect(creates[1]!.arguments).toEqual(creates[0]!.arguments);
    expect(creates[0]!.arguments!.idempotencyKey).toBe("proposal-0f1e2d3c-fixed");
    expect(page.root.textContent).toContain("Already done: “File taxes” was created before.");
  });

  it("shows the server's refusal and lets the user try again", async () => {
    const { root, calls, buttons, press } = await withHost(() => new Error("That task no longer exists."));
    await press(buttons("Confirm")[0]!);
    expect(calls.map((c) => c.name)).toEqual(["update_task"]);
    expect(root.querySelector("[role=alert]")?.textContent).toBe("That task no longer exists.");
    expect(buttons("Confirm")[0]!.disabled).toBe(false);
  });

  it("\"Not now\" calls nothing; a declined new task leaves no card", async () => {
    const { calls, buttons, press, root } = await withHost();
    await press(buttons("Not now")[1]!);
    expect(calls).toEqual([]);
    expect(root.textContent).toContain("Dismissed.");
    // One task card is left: the updated task's (the new task's draft is gone).
    expect(root.querySelectorAll("[aria-label='Influence or concern']")).toHaveLength(1);
  });
});
