import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexLogin } from "@clock-compass/web-client/api";

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
vi.mock("./toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { codexStore, CODEX_POLL_MS } = await import("./codex");

const pending: CodexLogin = {
  state: "pending",
  userCode: "ABCD-1234",
  verificationUri: "https://auth.example.test/device",
};

/** Let a poll's timer fire and its awaited request settle. */
async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(CODEX_POLL_MS);
}

describe("codexStore sign-in polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    codexStore.stopPolling();
  });
  afterEach(() => {
    codexStore.stopPolling();
    vi.useRealTimers();
  });

  it("polls until connected, then refreshes the AI status", async () => {
    api.getCodexLogin.mockResolvedValueOnce(pending).mockResolvedValueOnce({ state: "connected" });
    await codexStore.connect();
    expect(codexStore.getSnapshot()).toMatchObject({ phase: "pending", userCode: "ABCD-1234" });
    await tick();
    expect(codexStore.getSnapshot().phase).toBe("pending");
    await tick();
    expect(codexStore.getSnapshot().phase).toBe("idle");
    expect(api.getAiStatus).toHaveBeenCalled();
    await tick();
    expect(api.getCodexLogin).toHaveBeenCalledTimes(2);
  });

  it("does not restart polling when a poll is in flight during disconnect", async () => {
    let resolve!: (login: CodexLogin) => void;
    api.getCodexLogin.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await codexStore.connect();
    await tick(); // the poll is now waiting on the server
    await codexStore.disconnect();
    resolve(pending);
    await tick();
    await tick();
    expect(api.getCodexLogin).toHaveBeenCalledTimes(1);
    expect(codexStore.getSnapshot().phase).toBe("idle");
  });

  it("stops with an error when the server dropped the flow", async () => {
    api.getCodexLogin.mockResolvedValueOnce({ state: "idle" });
    await codexStore.connect();
    await tick();
    expect(codexStore.getSnapshot()).toMatchObject({
      phase: "error",
      errorMsg: "Sign-in was interrupted — try again.",
    });
    await tick();
    expect(api.getCodexLogin).toHaveBeenCalledTimes(1);
  });
});
