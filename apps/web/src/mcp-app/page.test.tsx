// @vitest-environment happy-dom
/**
 * The MCP App page (#118) against a stand-in host: the SDK's own AppBridge,
 * linked to the page's App in memory, sends what Claude Desktop would send.
 * The tool result is a real `show_week` answer (the fixture; core's tests
 * check it is exactly what the server builds).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startPage } from "./page";
import week from "./week-result.fixture.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function host(theme: "light" | "dark") {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const [hostSide, pageSide] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(null, { name: "stand-in host", version: "0" }, {}, { hostContext: { theme } });
  const initialized = new Promise<void>((resolve) => (bridge.oninitialized = () => resolve()));
  await bridge.connect(hostSide);
  await act(async () => {
    await startPage(root, new App({ name: "Clock & Compass", version: "1.0.0" }), pageSide);
    await initialized;
  });
  const send = async (result: Parameters<AppBridge["sendToolResult"]>[0]) =>
    act(async () => {
      await bridge.sendToolResult(result);
      await new Promise((r) => setTimeout(r, 0));
    });
  return { root, bridge, send };
}

afterEach(() => document.documentElement.classList.remove("dark"));

describe("the MCP App page in a stand-in host", () => {
  it("draws the week from a show_week result", async () => {
    const { root, send } = await host("light");
    expect(root.textContent).toBe("Loading…");
    await send(week as Parameters<AppBridge["sendToolResult"]>[0]);
    const text = root.textContent ?? "";
    expect(text).toContain("Week of 16 November");
    expect(text).toContain("○ Plan the garden");
    expect(text).toContain("Saturday 2109:00 Plan the garden");
    expect(text.match(/Nothing scheduled/g)).toHaveLength(6);
  });

  it("starts in the host's theme and follows a change", async () => {
    const { bridge } = await host("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await act(async () => {
      bridge.setHostContext({ theme: "light" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("shows a refused screen as its sentence", async () => {
    const { root, send } = await host("light");
    await send({ isError: true, content: [{ type: "text", text: "This shows data the user has not shared with AI." }] });
    expect(root.querySelector("[role=alert]")?.textContent).toBe("This shows data the user has not shared with AI.");
  });
});
