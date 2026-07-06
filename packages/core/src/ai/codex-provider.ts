import type { ProactivityTag } from "@prisma/client";
import type { ProviderCredentialRepository } from "../repositories/provider-credential-repository.js";
import type {
  AiProvider,
  TaskClassification,
  WeeklyReviewContext,
} from "./provider.js";
import {
  CLASSIFY_JSON_SHAPE,
  CLASSIFY_SYSTEM,
  MISSION_SYSTEM,
  PROACTIVITY_JSON_SHAPE,
  REVIEW_SYSTEM,
} from "./prompts.js";
import { parseClassification, parseProactivity } from "./parse.js";
import {
  extractAccountId,
  refreshCodexTokens,
  type CodexTokens,
} from "./codex-oauth.js";

/** The provider key under which Codex OAuth credentials are stored. */
export const CODEX_PROVIDER = "openai-codex";

/** The Codex subscription backend (the same endpoint the Codex CLI talks to). */
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
/**
 * Identifies the client to the Codex backend. "codex_cli_rs" is the canonical
 * originator for the Codex CLI client id we authenticate with.
 */
const ORIGINATOR = "codex_cli_rs";
/** A general default; override with OPENAI_MODEL / the provider option. */
const DEFAULT_MODEL = "gpt-5";
/** Refresh a little before expiry so a call never races the token going stale. */
const REFRESH_SKEW_MS = 60_000;

/**
 * Thrown when an AI call is attempted but the ChatGPT account isn't connected
 * (or its tokens can no longer be refreshed). The route layer maps this to a
 * 503 with a "connect your account in Settings" message rather than a 500.
 */
export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAuthError";
  }
}

export interface CodexConnectionStatus {
  connected: boolean;
  accountId: string | null;
  label: string | null;
  /** ISO timestamp of the current access token's expiry, when connected. */
  expiresAt: string | null;
}

/**
 * Owns the stored Codex OAuth credentials: reads them, refreshes the access
 * token transparently when it's about to expire (persisting rotated tokens),
 * and reports connection status. The only stateful piece between the OAuth
 * flow and the provider.
 */
export class CodexCredentialManager {
  constructor(private readonly repo: ProviderCredentialRepository) {}

  /** Persist a freshly minted set of tokens (after a device login). */
  async save(tokens: CodexTokens, label?: string): Promise<void> {
    await this.repo.upsert(CODEX_PROVIDER, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountId: tokens.accountId,
      expiresAt: new Date(tokens.expiresAt),
      label: label ?? "ChatGPT subscription",
    });
  }

  /** Forget the connection. */
  async disconnect(): Promise<void> {
    await this.repo.delete(CODEX_PROVIDER);
  }

  async status(): Promise<CodexConnectionStatus> {
    const row = await this.repo.get(CODEX_PROVIDER);
    if (!row) {
      return { connected: false, accountId: null, label: null, expiresAt: null };
    }
    return {
      connected: true,
      accountId: row.accountId,
      label: row.label,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * A valid bearer token + account id, refreshing first if it's about to lapse.
   * Returns null when no account is connected; throws CodexAuthError when a
   * connected account's token can no longer be refreshed (re-auth needed).
   */
  async getAccessToken(): Promise<{ accessToken: string; accountId: string } | null> {
    const row = await this.repo.get(CODEX_PROVIDER);
    if (!row) return null;

    if (row.expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
      return {
        accessToken: row.accessToken,
        accountId: row.accountId ?? extractAccountId(row.accessToken),
      };
    }

    // Expiring (or expired) — refresh and persist the rotated tokens.
    let refreshed: CodexTokens;
    try {
      refreshed = await refreshCodexTokens(row.refreshToken);
    } catch (err) {
      throw new CodexAuthError(
        `Your ChatGPT sign-in has expired and couldn't be refreshed (${
          err instanceof Error ? err.message : String(err)
        }). Reconnect under Settings.`,
      );
    }
    await this.repo.upsert(CODEX_PROVIDER, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accountId: refreshed.accountId,
      expiresAt: new Date(refreshed.expiresAt),
      label: row.label,
    });
    return { accessToken: refreshed.accessToken, accountId: refreshed.accountId };
  }
}

/** SSE/`response.completed` event shapes we read text and errors out of. */
interface CodexStreamEvent {
  type?: string;
  delta?: string;
  response?: {
    output?: {
      type?: string;
      content?: { type?: string; text?: string }[];
    }[];
  };
  error?: { message?: string; code?: string; type?: string };
  message?: string;
}

/**
 * AI provider backed by a ChatGPT Plus/Pro subscription via Codex OAuth.
 *
 * Plain fetch against the Codex `/responses` endpoint (no SDK, no framework) —
 * the same posture as OpenAiCompatibleProvider. The endpoint only streams, so
 * we consume the SSE stream and keep the final text. Structured jobs ask for
 * JSON in the prompt and validate it here (shared with the OpenAI-compatible
 * provider), since the experimental backend doesn't guarantee schema mode.
 */
export class CodexResponsesProvider implements AiProvider {
  // Selected => available. Whether an account is actually connected is a
  // separate, runtime concern surfaced through `ready()`.
  readonly available = true;
  private readonly model: string;

  constructor(
    private readonly credentials: CodexCredentialManager,
    options: { model?: string } = {},
  ) {
    this.model = options.model || DEFAULT_MODEL;
  }

  /** Ready only once an account is connected and its token is usable. */
  async ready(): Promise<boolean> {
    try {
      return !!(await this.credentials.getAccessToken());
    } catch {
      return false;
    }
  }

  private async respond(system: string, user: string): Promise<string> {
    const auth = await this.credentials.getAccessToken();
    if (!auth) {
      throw new CodexAuthError(
        "No ChatGPT account is connected. Connect one under Settings → AI.",
      );
    }

    const response = await fetch(CODEX_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "chatgpt-account-id": auth.accountId,
        originator: ORIGINATOR,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "OpenAI-Beta": "responses=experimental",
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        stream: true,
        instructions: system,
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: user }] },
        ],
        include: ["reasoning.encrypted_content"],
      }),
    });

    if (!response.ok) {
      throw mapHttpError(response.status, await response.text().catch(() => ""));
    }
    if (!response.body) throw new Error("Codex returned no response stream.");
    return readCodexStream(response.body);
  }

  async classifyTask(text: string, today: string): Promise<TaskClassification> {
    const raw = JSON.parse(
      await this.respond(
        `${CLASSIFY_SYSTEM}\n\n${CLASSIFY_JSON_SHAPE}`,
        `Current date: ${today}\n\nTask sentence: ${text}`,
      ),
    );
    return parseClassification(raw, text);
  }

  async tagProactivity(title: string, notes?: string | null): Promise<ProactivityTag> {
    const raw = JSON.parse(
      await this.respond(
        `${CLASSIFY_SYSTEM}\n\n${PROACTIVITY_JSON_SHAPE}`,
        `Tag this task as INFLUENCE or CONCERN.\nTitle: ${title}${notes ? `\nNotes: ${notes}` : ""}`,
      ),
    );
    return parseProactivity(raw);
  }

  refineMission(draft: string): Promise<string> {
    return this.respond(MISSION_SYSTEM, draft);
  }

  weeklyReview(context: WeeklyReviewContext): Promise<string> {
    return this.respond(REVIEW_SYSTEM, JSON.stringify(context, null, 2));
  }
}

/** Turn an error HTTP status/body into a friendly Error (quota especially). */
function mapHttpError(status: number, body: string): Error {
  let code = "";
  let message = "";
  try {
    const err = (JSON.parse(body) as { error?: { code?: string; type?: string; message?: string } })
      .error;
    code = err?.code || err?.type || "";
    message = err?.message || "";
  } catch {
    // non-JSON body
  }
  if (status === 429 || /usage_limit_reached|usage_not_included|rate_limit/i.test(code)) {
    return new Error(
      "Your ChatGPT subscription usage limit has been reached. Try again later, or configure a different AI provider.",
    );
  }
  if (status === 401 || status === 403) {
    return new CodexAuthError(
      "ChatGPT rejected the stored credentials. Reconnect your account under Settings.",
    );
  }
  return new Error(`Codex request failed (${status})${message ? `: ${message}` : ""}`);
}

/**
 * Consume the Codex SSE stream and return the assistant's text. We accumulate
 * `output_text` deltas and fall back to the final `response.completed` payload;
 * an `error`/`response.failed` event throws.
 */
async function readCodexStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let deltas = "";
  let finalText = "";

  const handle = (event: CodexStreamEvent): void => {
    if (event.type === "error" || event.type === "response.failed") {
      throw new Error(event.error?.message || event.message || "Codex streaming error.");
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      deltas += event.delta;
      return;
    }
    if (
      (event.type === "response.completed" ||
        event.type === "response.done" ||
        event.type === "response.incomplete") &&
      event.response
    ) {
      finalText = textFromResponse(event.response);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        handle(JSON.parse(data) as CodexStreamEvent);
      } catch (err) {
        if (err instanceof Error && err.message.includes("Codex")) throw err;
        // Otherwise it's a JSON parse hiccup on a partial line — skip it.
      }
    }
  }

  const text = (finalText || deltas).trim();
  if (!text) throw new Error("Codex returned an empty response.");
  return text;
}

/** Extract concatenated output_text from a Responses API `response` object. */
function textFromResponse(response: NonNullable<CodexStreamEvent["response"]>): string {
  let text = "";
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  return text;
}
