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
import { credentialPlace, secretsBox } from "../secrets/box.js";

/** A test secret (32 bytes in base64) and another one, as after a change of SECRETS_KEY. */
const box = secretsBox(Buffer.alloc(32, 7).toString("base64"));
const otherBox = secretsBox(Buffer.alloc(32, 8).toString("base64"));

/** Store tokens as this version does: sealed with the test secret (#103). */
function seed(repo: FakeRepo, data: ProviderCredentialInput, with_ = box) {
  return repo.upsert("openai-codex", {
    ...data,
    accessToken: with_.seal(data.accessToken, credentialPlace("accessToken", "openai-codex")),
    refreshToken: with_.seal(data.refreshToken, credentialPlace("refreshToken", "openai-codex")),
  });
}

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
    const mgr = new CodexCredentialManager(repo, box);
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
    await seed(repo, {
      accessToken: fakeAccessToken("acc_1"),
      refreshToken: "r",
      accountId: "acc_1",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const mgr = new CodexCredentialManager(repo, box);
    const auth = await mgr.getAccessToken();
    expect(auth?.accountId).toBe("acc_1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes and persists when the token is about to expire", async () => {
    const repo = new FakeRepo();
    await seed(repo, {
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
    const mgr = new CodexCredentialManager(repo, box);
    const auth = await mgr.getAccessToken();
    expect(auth?.accountId).toBe("acc_new");
    // The rotated token is persisted, sealed.
    expect(repo.row?.refreshToken).toMatch(/^enc1:/);
    expect(box.open(repo.row!.refreshToken, credentialPlace("refreshToken", "openai-codex"))).toEqual({ ok: true, value: "new_refresh" });
  });

  it("throws CodexAuthError when a refresh fails", async () => {
    const repo = new FakeRepo();
    await seed(repo, {
      accessToken: fakeAccessToken("x"),
      refreshToken: "bad",
      accountId: "x",
      expiresAt: new Date(Date.now() + 1000),
    });
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 400 }));
    const mgr = new CodexCredentialManager(repo, box);
    await expect(mgr.getAccessToken()).rejects.toBeInstanceOf(CodexAuthError);
  });

  it("stores the tokens sealed, never as they came (#103)", async () => {
    const repo = new FakeRepo();
    const access = fakeAccessToken("acc_1");
    await new CodexCredentialManager(repo, box).save({ accessToken: access, refreshToken: "SENTINEL-REFRESH", accountId: "acc_1", expiresAt: Date.now() + 3_600_000 });
    expect(repo.row?.accessToken).toMatch(/^enc1:/);
    expect(JSON.stringify(repo.row)).not.toContain("SENTINEL-REFRESH");
    expect(JSON.stringify(repo.row)).not.toContain(access);
  });

  it("refuses to store a sign-in without a valid SECRETS_KEY, and says so without any value (#103)", async () => {
    for (const raw of [undefined, "not-a-key"]) {
      const repo = new FakeRepo();
      const mgr = new CodexCredentialManager(repo, secretsBox(raw));
      expect(mgr.storeRefusal()).toMatch(/^Keys and sign-ins cannot be saved: this server/);
      await expect(mgr.save({ accessToken: "a", refreshToken: "b", accountId: "x", expiresAt: Date.now() + 1000 })).rejects.toThrow(/SECRETS_KEY/);
      expect(repo.row).toBeNull();
    }
    expect(new CodexCredentialManager(new FakeRepo(), box).storeRefusal()).toBeNull();
  });

  it("never uses, refreshes or changes a sign-in stored as plain text before #103", async () => {
    const repo = new FakeRepo();
    // As a version before #103 stored it: the tokens bare, about to expire.
    await repo.upsert("openai-codex", { accessToken: fakeAccessToken("old"), refreshToken: "PLAIN-REFRESH", accountId: "old", expiresAt: new Date(Date.now() + 1000) });
    const before = { ...repo.row! };
    const mgr = new CodexCredentialManager(repo, box);
    expect(await mgr.status()).toMatchObject({ connected: false, problem: "before-encryption" });
    await expect(mgr.getAccessToken()).rejects.toThrow(/stored before sign-ins were encrypted/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repo.row).toEqual(before);
  });

  it("with another SECRETS_KEY, or none, a sealed sign-in is not used and not changed", async () => {
    const repo = new FakeRepo();
    await seed(repo, { accessToken: fakeAccessToken("acc_1"), refreshToken: "r", accountId: "acc_1", expiresAt: new Date(Date.now() + 1000) }, otherBox);
    const before = { ...repo.row! };
    expect(await new CodexCredentialManager(repo, box).status()).toMatchObject({ connected: false, problem: "other-secret" });
    expect(await new CodexCredentialManager(repo, secretsBox(undefined)).status()).toMatchObject({ connected: false, problem: "no-secret" });
    await expect(new CodexCredentialManager(repo, box).getAccessToken()).rejects.toThrow(/another SECRETS_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repo.row).toEqual(before);
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
      accessToken: box.seal(fakeAccessToken("acc_1"), credentialPlace("accessToken", "openai-codex")),
      refreshToken: box.seal("r", credentialPlace("refreshToken", "openai-codex")),
      accountId: "acc_1",
      expiresAt: new Date(Date.now() + 3_600_000),
      label: "ChatGPT subscription",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return new CodexCredentialManager(repo, box);
  }

  it("is not ready without a connection and refuses to call out", async () => {
    const provider = new CodexResponsesProvider(new CodexCredentialManager(new FakeRepo(), box));
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
