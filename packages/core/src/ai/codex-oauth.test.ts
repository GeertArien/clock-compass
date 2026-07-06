import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  awaitCodexDeviceApproval,
  exchangeCodexCode,
  extractAccountId,
  pollCodexDeviceToken,
  refreshCodexTokens,
  startCodexDeviceAuth,
  type CodexDeviceCode,
} from "./codex-oauth.js";

/** A JWT whose payload carries the ChatGPT account id under OpenAI's claim. */
function fakeAccessToken(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
  ).toString("base64url");
  return `header.${payload}.sig`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("codex-oauth", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("extracts the account id from an access token", () => {
    expect(extractAccountId(fakeAccessToken("acc_42"))).toBe("acc_42");
    expect(() => extractAccountId("not-a-jwt")).toThrow();
  });

  it("starts a device auth and normalises a string interval", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ device_auth_id: "dev_1", user_code: "WXYZ-1234", interval: "5" }),
    );
    const device = await startCodexDeviceAuth();
    expect(device).toMatchObject({
      deviceAuthId: "dev_1",
      userCode: "WXYZ-1234",
      intervalSeconds: 5,
    });
    expect(device.verificationUri).toContain("/codex/device");
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/deviceauth/usercode");
  });

  it("maps poll responses to pending / slow_down / complete / failed", async () => {
    const device = { deviceAuthId: "d", userCode: "c" };

    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
    expect(await pollCodexDeviceToken(device)).toEqual({ status: "pending" });

    fetchMock.mockResolvedValueOnce(json({ error: { code: "slow_down" } }, 400));
    expect(await pollCodexDeviceToken(device)).toEqual({ status: "slow_down" });

    fetchMock.mockResolvedValueOnce(
      json({ authorization_code: "auth_1", code_verifier: "ver_1" }),
    );
    expect(await pollCodexDeviceToken(device)).toEqual({
      status: "complete",
      authorizationCode: "auth_1",
      codeVerifier: "ver_1",
    });

    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect(await pollCodexDeviceToken(device)).toMatchObject({ status: "failed" });
  });

  it("exchanges a code and reads the account id from the token", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        access_token: fakeAccessToken("acc_99"),
        refresh_token: "refresh_1",
        expires_in: 3600,
      }),
    );
    const before = Date.now();
    const tokens = await exchangeCodexCode("auth_1", "ver_1");
    expect(tokens.accountId).toBe("acc_99");
    expect(tokens.refreshToken).toBe("refresh_1");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50);

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("POST");
    const params = new URLSearchParams((init as RequestInit).body as string);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("auth_1");
  });

  it("refreshes tokens", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        access_token: fakeAccessToken("acc_1"),
        refresh_token: "refresh_2",
        expires_in: 100,
      }),
    );
    const tokens = await refreshCodexTokens("refresh_1");
    expect(tokens.refreshToken).toBe("refresh_2");
    const params = new URLSearchParams(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(params.get("grant_type")).toBe("refresh_token");
  });

  it("polls until approval, honouring slow_down without real waits", async () => {
    const device: CodexDeviceCode = {
      deviceAuthId: "d",
      userCode: "c",
      verificationUri: "https://auth.openai.com/codex/device",
      intervalSeconds: 5,
      expiresInSeconds: 900,
    };
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 403 })) // pending
      .mockResolvedValueOnce(json({ error: { code: "slow_down" } }, 400)) // slow down
      .mockResolvedValueOnce(json({ authorization_code: "a", code_verifier: "v" }));

    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await awaitCodexDeviceApproval(device, { sleep });
    expect(result).toEqual({ authorizationCode: "a", codeVerifier: "v" });
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("gives up once the device code expires", async () => {
    const device: CodexDeviceCode = {
      deviceAuthId: "d",
      userCode: "c",
      verificationUri: "x",
      intervalSeconds: 5,
      expiresInSeconds: 900,
    };
    fetchMock.mockResolvedValue(new Response("", { status: 403 })); // forever pending
    let clock = 0;
    const now = () => clock;
    const sleep = vi.fn().mockImplementation(() => {
      clock += 60_000; // advance a minute each poll
      return Promise.resolve();
    });
    await expect(awaitCodexDeviceApproval(device, { sleep, now })).rejects.toThrow(
      /expired/,
    );
  });
});
