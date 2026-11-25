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
const BRIDGES: [string, () => Bridge][] = [
  ["ext-apps 1.7.5", () => new AppBridgeV1(null, { name: "stand-in host", version: "0" }, HOST_CAPABILITIES, { hostContext: { theme } }) as unknown as Bridge],
  ["ext-apps 2.0.4 (Open WebUI's)", () => new AppBridgeV2(null, { name: "stand-in host", version: "0" }, HOST_CAPABILITIES, { hostContext: { theme } }) as unknown as Bridge],
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
 * Step 3: a `propose_changes` result (the fixture is exactly what core
 * builds), confirmed with a press in the page. The stand-in host answers the
 * page's tool calls as the MCP program would and records them, so each test
 * says which calls a Confirm makes through the host.
 */
describe.each(BRIDGES)("proposals confirmed in the page, %s (step 3)", (_name, make) => {
  type Call = { name: string; arguments?: Record<string, unknown> };
  const listed = proposal.structuredContent.reads[0]!.result as { tasks: Record<string, unknown>[] };
  const moved = { ...listed, tasks: listed.tasks.map((t) => (t.id === "t3" ? { ...t, scheduledDay: "2026-11-26", scheduledTime: "10:00" } : t)) };
  const changes = proposal.structuredContent.changes;

  /** A host that answers the writes and the reads, and records every call and every model-context update. */
  async function withHost(answer: (call: Call) => unknown = () => ({ changed: 1 })) {
    const page = await host("light", make);
    const calls: Call[] = [];
    const told: string[] = [];
    page.bridge.oncalltool = async (params) => {
      calls.push(params);
      if (params.name === "list_tasks") return { content: [], structuredContent: moved };
      const out = answer(params);
      return out instanceof Error ? { isError: true, content: [{ type: "text", text: out.message }] } : { content: [], structuredContent: out as Record<string, unknown> };
    };
    (page.bridge as unknown as { onupdatemodelcontext: (p: { content?: { text?: string }[] }) => Promise<object> }).onupdatemodelcontext = async (p) => {
      told.push(p.content?.[0]?.text ?? "");
      return {};
    };
    await page.send(proposal as ToolResult);
    const buttons = (label: string) => [...page.root.querySelectorAll("button")].filter((b) => b.textContent === label);
    const press = async (button: HTMLButtonElement) =>
      act(async () => {
        button.click();
        for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      });
    return { ...page, calls, told, buttons, press };
  }

  it("draws each change with the app's sentence, the card as after Confirm, and a Confirm; calls nothing", async () => {
    const { root, calls, buttons } = await withHost();
    const text = root.textContent ?? "";
    expect(text).toContain("2 proposed changes");
    expect(text).toContain("If you confirm: Change “Call the plumber”: on 2026-11-26 at 10:00 (was not on the Clock).");
    expect(text).toContain("If you confirm: Create the task “File taxes”, important, due 2027-04-01.");
    expect(text).toContain("After you confirm");
    expect(buttons("Confirm")).toHaveLength(2);
    expect(buttons("Confirm").every((b) => !b.disabled)).toBe(true);
    expect(calls).toEqual([]);
  });

  it("a Confirm sends the server's arguments untouched in one write, then reads back only what it touched", async () => {
    const { root, calls, told, buttons, press } = await withHost();
    await press(buttons("Confirm")[0]!);
    expect(calls.map(({ name, arguments: args }) => ({ name, arguments: args }))).toEqual([
      { name: "update_task", arguments: changes[0]!.arguments },
      { name: "list_tasks", arguments: { limit: 200 } },
    ]);
    expect(root.textContent).toContain("Done.");
    // The card is the live task again, as the read answered it.
    expect(root.textContent).not.toContain("After you confirm");
    // The conversation is told what the user confirmed (the host offers it).
    expect(told).toEqual(["The user confirmed: Change “Call the plumber”: on 2026-11-26 at 10:00 (was not on the Clock)."]);
    // A second press does nothing: the bar is locked.
    await press(buttons("Confirm")[0]!);
    expect(calls).toHaveLength(2);
  });

  it("a create carries the server's key; the same result drawn again and confirmed again makes nothing twice", async () => {
    let made = 0;
    const page = await withHost((call) => (call.name === "create_task" ? { changed: made++ === 0 ? 1 : 0, id: "k-new" } : { changed: 1 }));
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

  it("\"Not now\" calls nothing", async () => {
    const { calls, buttons, press, root } = await withHost();
    await press(buttons("Not now")[0]!);
    expect(calls).toEqual([]);
    expect(root.textContent).toContain("Dismissed.");
  });
});
