// "Sign in with ChatGPT" — the Codex OAuth device-code flow.
//
// This lets the app borrow a ChatGPT Plus/Pro subscription as an AI backend
// instead of a metered API key. OpenAI sanctions this flow for third-party
// tools (it's the same one the Codex CLI uses); we deliberately implement it
// with plain fetch rather than pulling in an LLM framework — the same posture
// as the rest of this folder (see CLAUDE.md: "deliberately no LLM framework").
//
// We use the DEVICE-CODE variant, not the browser-callback variant: this app
// runs on a remote server (behind a reverse proxy), so there is no localhost
// for an OAuth redirect to land on. The user reads a short code off the screen
// and approves it at chatgpt.com from any browser; the server polls in the
// background and exchanges the result for tokens.

/** The public Codex OAuth client id (same one the Codex CLI ships with). */
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
/** Where the user goes to type the code. */
export const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
/** Redirect uri the device flow exchanges its code against (not a real server). */
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
/** The whole device approval is valid for 15 minutes. */
export const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;
/** JWT claim namespace OpenAI nests the ChatGPT account id under. */
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

/** A resolved set of OAuth tokens, ready to persist. */
export interface CodexTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch millis when the access token expires. */
  expiresAt: number;
  /** ChatGPT account id, extracted from the access token's JWT claims. */
  accountId: string;
}

/** What the UI shows the user to approve a device. */
export interface CodexDeviceCode {
  deviceAuthId: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

/** One poll of the device-token endpoint. */
export type CodexPollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "complete"; authorizationCode: string; codeVerifier: string }
  | { status: "failed"; message: string };

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/** Decode a JWT payload without verifying the signature (we only read claims). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1]!, "base64url").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Pull the ChatGPT account id out of an access token, or throw if absent. */
export function extractAccountId(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH] as { chatgpt_account_id?: unknown } | undefined;
  const accountId = auth?.chatgpt_account_id;
  if (typeof accountId !== "string" || !accountId) {
    throw new Error("Could not read the ChatGPT account id from the access token.");
  }
  return accountId;
}

async function readTokenResponse(
  response: Response,
  operation: string,
): Promise<CodexTokens> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Codex token ${operation} failed (${response.status}): ${text || response.statusText}`,
    );
  }
  const json = (await response.json()) as RawTokenResponse;
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error(`Codex token ${operation} response was missing fields.`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    accountId: extractAccountId(json.access_token),
  };
}

/** Step 1: ask OpenAI for a user code the person will approve in a browser. */
export async function startCodexDeviceAuth(): Promise<CodexDeviceCode> {
  const response = await fetch(DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "Codex device-code login is not available right now. Try again later.",
      );
    }
    const text = await response.text().catch(() => "");
    throw new Error(
      `Codex device-code request failed (${response.status})${text ? `: ${text}` : ""}`,
    );
  }
  const json = (await response.json()) as {
    device_auth_id?: string;
    user_code?: string;
    interval?: number | string;
  };
  const interval =
    typeof json.interval === "string" ? Number(json.interval.trim()) : json.interval;
  if (
    !json.device_auth_id ||
    !json.user_code ||
    typeof interval !== "number" ||
    !Number.isFinite(interval) ||
    interval < 0
  ) {
    throw new Error("Codex returned an unexpected device-code response.");
  }
  return {
    deviceAuthId: json.device_auth_id,
    userCode: json.user_code,
    verificationUri: DEVICE_VERIFICATION_URI,
    intervalSeconds: interval,
    expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
  };
}

/** Step 2: poll once. Repeat on `pending`/`slow_down` until `complete`. */
export async function pollCodexDeviceToken(
  device: Pick<CodexDeviceCode, "deviceAuthId" | "userCode">,
): Promise<CodexPollResult> {
  const response = await fetch(DEVICE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_auth_id: device.deviceAuthId,
      user_code: device.userCode,
    }),
  });
  if (response.ok) {
    const json = (await response.json()) as {
      authorization_code?: string;
      code_verifier?: string;
    };
    if (!json.authorization_code || !json.code_verifier) {
      return { status: "failed", message: "Codex device approval returned no code." };
    }
    return {
      status: "complete",
      authorizationCode: json.authorization_code,
      codeVerifier: json.code_verifier,
    };
  }
  // Not yet approved — OpenAI signals this a few different ways.
  if (response.status === 403 || response.status === 404) return { status: "pending" };
  const text = await response.text().catch(() => "");
  let code: string | undefined;
  try {
    const err = (JSON.parse(text) as { error?: unknown }).error;
    code = typeof err === "object" && err ? (err as { code?: string }).code : (err as string);
  } catch {
    // non-JSON body
  }
  if (code === "deviceauth_authorization_pending") return { status: "pending" };
  if (code === "slow_down") return { status: "slow_down" };
  return {
    status: "failed",
    message: `Codex device approval failed (${response.status})${text ? `: ${text}` : ""}`,
  };
}

/**
 * Step 2 (loop): poll until the user approves the device, then return the code.
 * Honours the server's `slow_down` backoff and gives up after the device code
 * expires. `sleep` is injectable so tests don't wait on real time.
 */
export async function awaitCodexDeviceApproval(
  device: CodexDeviceCode,
  opts: {
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<{ authorizationCode: string; codeVerifier: string }> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + device.expiresInSeconds * 1000;
  let intervalMs = Math.max(device.intervalSeconds, 1) * 1000;

  while (now() < deadline) {
    if (opts.signal?.aborted) throw new Error("Login cancelled.");
    await sleep(intervalMs);
    if (opts.signal?.aborted) throw new Error("Login cancelled.");
    const result = await pollCodexDeviceToken(device);
    if (result.status === "complete") {
      return {
        authorizationCode: result.authorizationCode,
        codeVerifier: result.codeVerifier,
      };
    }
    if (result.status === "failed") throw new Error(result.message);
    // Back off a touch when asked to slow down; "pending" just keeps waiting.
    if (result.status === "slow_down") intervalMs += 2000;
  }
  throw new Error("The sign-in code expired before it was approved. Try again.");
}

/** Step 3: trade the approved authorization code for tokens. */
export async function exchangeCodexCode(
  authorizationCode: string,
  codeVerifier: string,
): Promise<CodexTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: authorizationCode,
      code_verifier: codeVerifier,
      redirect_uri: DEVICE_REDIRECT_URI,
    }),
  });
  return readTokenResponse(response, "exchange");
}

/** Refresh an expiring access token. Refresh tokens may rotate, so persist both. */
export async function refreshCodexTokens(refreshToken: string): Promise<CodexTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  return readTokenResponse(response, "refresh");
}
