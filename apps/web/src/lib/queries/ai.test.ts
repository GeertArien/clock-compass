import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The sign-in poll is a refetchInterval, which the library skips on a server
// (no `window`). Hoisted above the imports, so the library loads as it does in
// the browser; its focus/online listeners check for addEventListener first.
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window ??= globalThis;
});
import { focusManager, QueryObserver, type QueryClient } from "@tanstack/react-query";
import type { CodexLogin } from "@clock-compass/web-client/api";
import { observe, run, settled, testQueryClient } from "./test-client";

const api = vi.hoisted(() => ({
  getCodexStatus: vi.fn(async () => ({
    connected: false,
    accountId: null,
    label: null,
    expiresAt: null,
  })),
  startCodexDevice: vi.fn(async () => ({
    userCode: "ABCD-1234",
    verificationUri: "https://auth.example.test/device",
    intervalSeconds: 5,
    expiresInSeconds: 900,
  })),
  getCodexLogin: vi.fn(async (): Promise<CodexLogin> => ({ state: "idle" })),
  codexDisconnect: vi.fn(async () => ({ ok: true })),
  getAiStatus: vi.fn(async () => ({ available: true, connected: false, oauth: true })),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const { aiStatusQuery, codexFlowQuery, codexPoll, connectCodex, disconnectCodex, CODEX_POLL_MS } =
  await import("./ai");

const pending: CodexLogin = {
  state: "pending",
  userCode: "ABCD-1234",
  verificationUri: "https://auth.example.test/device",
};

/**
 * What the app shell mounts: the AI status (the ✦ surfaces) and the sign-in
 * poll, re-optioned whenever the flow changes, as useCodexPolling re-renders.
 */
function mountShell(client: QueryClient) {
  const status = observe(client, aiStatusQuery);
  const flow = new QueryObserver(client, codexFlowQuery);
  const poll = new QueryObserver(client, codexPoll(flow.getCurrentResult().data!));
  const unsubs = [
    flow.subscribe((r) => poll.setOptions(codexPoll(r.data!))),
    poll.subscribe(() => {}),
    status.unsubscribe,
  ];
  return () => unsubs.forEach((u) => u());
}

const phase = (client: QueryClient) => client.getQueryData(codexFlowQuery.queryKey)?.phase;

/** Let one poll interval pass and its request settle. */
const interval = () => vi.advanceTimersByTimeAsync(CODEX_POLL_MS);

describe("AI status", () => {
  it("a failed check means no AI, not an error", async () => {
    api.getAiStatus.mockRejectedValueOnce(new Error("offline"));
    const client = testQueryClient();
    const { observer, unsubscribe } = observe(client, aiStatusQuery);
    const result = await settled(observer);
    expect(result.data).toEqual({ available: false, connected: false, oauth: false });
    expect(result.isError).toBe(false);
    unsubscribe();
  });
});

describe("ChatGPT sign-in polling", () => {
  let client: QueryClient;
  let unmount: () => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Answers queued with mock*Once and left unused don't leak between tests.
    api.getCodexLogin.mockReset().mockResolvedValue({ state: "idle" });
    api.startCodexDevice.mockClear();
    client = testQueryClient();
    unmount = mountShell(client);
    await vi.advanceTimersByTimeAsync(0); // the AI status loads
  });
  afterEach(() => {
    unmount();
    client.clear();
    vi.useRealTimers();
  });

  it("polls until connected, then refreshes the AI status, and stops", async () => {
    api.getCodexLogin.mockResolvedValueOnce(pending).mockResolvedValueOnce({ state: "connected" });
    await run(client, connectCodex, undefined);
    expect(client.getQueryData(codexFlowQuery.queryKey)).toMatchObject({
      phase: "pending",
      userCode: "ABCD-1234",
    });
    await vi.advanceTimersByTimeAsync(0); // first poll: still pending
    expect(phase(client)).toBe("pending");
    const statusChecks = api.getAiStatus.mock.calls.length;
    await interval(); // second poll: connected
    expect(phase(client)).toBe("idle");
    expect(toastMock.success).toHaveBeenCalledWith("ChatGPT connected");
    expect(api.getAiStatus.mock.calls.length).toBe(statusChecks + 1);
    await interval();
    await interval();
    expect(api.getCodexLogin).toHaveBeenCalledTimes(2);
  });

  it("does not restart polling when a poll is in flight during disconnect", async () => {
    let resolve!: (login: CodexLogin) => void;
    api.getCodexLogin.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await run(client, connectCodex, undefined);
    await vi.advanceTimersByTimeAsync(0); // the poll is now waiting on the server
    await run(client, disconnectCodex, undefined);
    resolve(pending);
    await interval();
    await interval();
    expect(api.getCodexLogin).toHaveBeenCalledTimes(1);
    expect(phase(client)).toBe("idle");
  });

  it("a poll answering 'connected' after a disconnect changes nothing", async () => {
    let resolve!: (login: CodexLogin) => void;
    api.getCodexLogin.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await run(client, connectCodex, undefined);
    await vi.advanceTimersByTimeAsync(0);
    await run(client, disconnectCodex, undefined);
    toastMock.success.mockClear();
    resolve({ state: "connected" });
    await vi.advanceTimersByTimeAsync(0);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(phase(client)).toBe("idle");
  });

  it("stops with an error when the server dropped the flow", async () => {
    api.getCodexLogin.mockResolvedValueOnce({ state: "idle" });
    await run(client, connectCodex, undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getQueryData(codexFlowQuery.queryKey)).toMatchObject({
      phase: "error",
      errorMsg: "Sign-in was interrupted — try again.",
    });
    await interval();
    expect(api.getCodexLogin).toHaveBeenCalledTimes(1);
  });

  it("keeps polling while the tab is hidden (approving at ChatGPT in another tab)", async () => {
    api.getCodexLogin
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ state: "connected" });
    await run(client, connectCodex, undefined);
    await vi.advanceTimersByTimeAsync(0);
    focusManager.setFocused(false);
    try {
      await interval();
      await interval();
      expect(api.getCodexLogin).toHaveBeenCalledTimes(3);
      expect(phase(client)).toBe("idle");
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it("keeps waiting through a failed poll", async () => {
    api.getCodexLogin
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ state: "connected" });
    await run(client, connectCodex, undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(phase(client)).toBe("pending");
    await interval();
    await interval();
    expect(phase(client)).toBe("idle");
    expect(api.getCodexLogin).toHaveBeenCalledTimes(3);
  });

  it("a sign-in that can't start shows why", async () => {
    api.startCodexDevice.mockRejectedValueOnce(new Error("Provider not configured"));
    await run(client, connectCodex, undefined);
    expect(client.getQueryData(codexFlowQuery.queryKey)).toMatchObject({
      phase: "error",
      errorMsg: "Provider not configured",
    });
    await interval();
    expect(api.getCodexLogin).not.toHaveBeenCalled();
  });

  it("invalidating everything (a new token) leaves a sign-in in progress alone", async () => {
    api.getCodexLogin.mockResolvedValue(pending);
    await run(client, connectCodex, undefined);
    await client.invalidateQueries();
    expect(client.getQueryData(codexFlowQuery.queryKey)).toMatchObject({
      phase: "pending",
      userCode: "ABCD-1234",
    });
  });
});
