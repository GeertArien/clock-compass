import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderCredential } from "@prisma/client";
import type {
  ProviderCredentialInput,
  ProviderCredentialRepository,
} from "../repositories/provider-credential-repository.js";
import {
  CodexAuthError,
  CodexCredentialManager,
  CodexResponsesProvider,
} from "./codex-provider.js";

function fakeAccessToken(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
  ).toString("base64url");
  return `header.${payload}.sig`;
}

/** A tiny in-memory stand-in for the Prisma repository. */
class FakeRepo implements ProviderCredentialRepository {
  row: ProviderCredential | null = null;
  async get(): Promise<ProviderCredential | null> {
    return this.row;
  }
  async upsert(provider: string, data: ProviderCredentialInput): Promise<ProviderCredential> {
    this.row = {
      id: "1",
      provider,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      accountId: data.accountId ?? null,
      expiresAt: data.expiresAt,
      label: data.label ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return this.row;
  }
  async delete(): Promise<void> {
    this.row = null;
  }
}

/** Build an SSE body Response. */
function sse(...events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function completed(text: string): object {
  return {
    type: "response.completed",
    response: {
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
    },
  };
}

describe("CodexCredentialManager", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reports disconnected with no row, connected once saved", async () => {
    const repo = new FakeRepo();
    const mgr = new CodexCredentialManager(repo);
    expect((await mgr.status()).connected).toBe(false);

    await mgr.save({
      accessToken: fakeAccessToken("acc_1"),
      refreshToken: "r",
      accountId: "acc_1",
      expiresAt: Date.now() + 3_600_000,
    });
    const status = await mgr.status();
    expect(status).toMatchObject({ connected: true, accountId: "acc_1" });
  });

  it("returns a still-valid token without refreshing", async () => {
    const repo = new FakeRepo();
    await repo.upsert("openai-codex", {
      accessToken: fakeAccessToken("acc_1"),
      refreshToken: "r",
      accountId: "acc_1",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const mgr = new CodexCredentialManager(repo);
    const auth = await mgr.getAccessToken();
    expect(auth?.accountId).toBe("acc_1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes and persists when the token is about to expire", async () => {
    const repo = new FakeRepo();
    await repo.upsert("openai-codex", {
      accessToken: fakeAccessToken("old"),
      refreshToken: "old_refresh",
      accountId: "old",
      expiresAt: new Date(Date.now() + 1000), // within the skew window
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: fakeAccessToken("acc_new"),
          refresh_token: "new_refresh",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const mgr = new CodexCredentialManager(repo);
    const auth = await mgr.getAccessToken();
    expect(auth?.accountId).toBe("acc_new");
    expect(repo.row?.refreshToken).toBe("new_refresh"); // rotated token persisted
  });

  it("throws CodexAuthError when a refresh fails", async () => {
    const repo = new FakeRepo();
    await repo.upsert("openai-codex", {
      accessToken: fakeAccessToken("x"),
      refreshToken: "bad",
      accountId: "x",
      expiresAt: new Date(Date.now() + 1000),
    });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 400 }));
    const mgr = new CodexCredentialManager(repo);
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(CodexAuthError);
  });
});

describe("CodexResponsesProvider", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  function connectedManager(): CodexCredentialManager {
    const repo = new FakeRepo();
    repo.row = {
      id: "1",
      provider: "openai-codex",
      accessToken: fakeAccessToken("acc_1"),
      refreshToken: "r",
      accountId: "acc_1",
      expiresAt: new Date(Date.now() + 3_600_000),
      label: "ChatGPT subscription",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return new CodexCredentialManager(repo);
  }

  it("is not ready without a connection and refuses to call out", async () => {
    const provider = new CodexResponsesProvider(new CodexCredentialManager(new FakeRepo()));
    expect(provider.available).toBe(true);
    expect(await provider.ready()).toBe(false);
    await expect(provider.refineMission("draft")).rejects.toBeInstanceOf(CodexAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies by parsing the streamed JSON, with the right headers", async () => {
    fetchMock.mockResolvedValueOnce(
      sse(
        completed(
          JSON.stringify({
            title: "Call mom",
            important: true,
            urgent: false,
            proactivity: "INFLUENCE",
            dueDate: "2026-06-13",
            rationale: "Q2 relationship.",
          }),
        ),
      ),
    );
    const provider = new CodexResponsesProvider(connectedManager());
    const result = await provider.classifyTask("call mom this weekend", "2026-06-10");
    expect(result).toMatchObject({ title: "Call mom", important: true, proactivity: "INFLUENCE" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/codex/responses");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toMatch(/^Bearer /);
    expect(headers["chatgpt-account-id"]).toBe("acc_1");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
  });

  it("assembles prose from output_text deltas", async () => {
    fetchMock.mockResolvedValueOnce(
      sse(
        { type: "response.output_text.delta", delta: "A refined " },
        { type: "response.output_text.delta", delta: "mission." },
      ),
    );
    const provider = new CodexResponsesProvider(connectedManager());
    expect(await provider.refineMission("draft")).toBe("A refined mission.");
  });

  it("surfaces a friendly message when the usage limit is hit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "usage_limit_reached" } }), { status: 429 }),
    );
    const provider = new CodexResponsesProvider(connectedManager());
    await expect(provider.refineMission("draft")).rejects.toThrow(/usage limit/i);
  });

  it("maps a 401 to a reconnect prompt", async () => {
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 401 }));
    const provider = new CodexResponsesProvider(connectedManager());
    await expect(provider.refineMission("draft")).rejects.toBeInstanceOf(CodexAuthError);
  });
});
