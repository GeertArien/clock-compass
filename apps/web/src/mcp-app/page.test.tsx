// @vitest-environment happy-dom
/**
 * The MCP App page (#118) against a stand-in host: the SDK's own AppBridge,
 * linked to the page's App in memory, sends what a host would send. It runs
 * twice: with the host side at ext-apps 1.7.5 (the version the page is built
 * with) and at 2.0.4 (the version Open WebUI hosts pages with), so the two
 * versions of the page protocol are checked against each other.
 * The tool result is a real `show_week` answer (the fixture; core's tests
 * check it is exactly what the server builds).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge as AppBridgeV1 } from "@modelcontextprotocol/ext-apps/app-bridge";
import { AppBridge as AppBridgeV2 } from "ext-apps-v2/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startPage } from "./page";
import week from "./week-result.fixture.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ToolResult = Parameters<AppBridgeV1["sendToolResult"]>[0];
/** The parts of a host bridge the tests use, the same in both versions. */
interface Bridge {
  oninitialized?: () => void;
  connect(transport: unknown): Promise<void>;
  sendToolResult(result: ToolResult): Promise<void>;
  setHostContext(context: { theme: "light" | "dark" }): void;
}
const BRIDGES: [string, () => Bridge][] = [
  ["ext-apps 1.7.5", () => new AppBridgeV1(null, { name: "stand-in host", version: "0" }, {}, { hostContext: { theme } }) as unknown as Bridge],
  ["ext-apps 2.0.4 (Open WebUI's)", () => new AppBridgeV2(null, { name: "stand-in host", version: "0" }, {}, { hostContext: { theme } }) as unknown as Bridge],
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
  await act(async () => {
    await startPage(root, new App({ name: "Clock & Compass", version: "1.0.0" }), pageSide);
    await initialized;
  });
  const send = async (result: ToolResult) =>
    act(async () => {
      await bridge.sendToolResult(result);
      await new Promise((r) => setTimeout(r, 0));
    });
  return { root, bridge, send };
}

afterEach(() => document.documentElement.classList.remove("dark"));

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

  it("shows a refused screen as its sentence", async () => {
    const { root, send } = await host("light", make);
    await send({ isError: true, content: [{ type: "text", text: "This shows data the user has not shared with AI." }] });
    expect(root.querySelector("[role=alert]")?.textContent).toBe("This shows data the user has not shared with AI.");
  });
});
