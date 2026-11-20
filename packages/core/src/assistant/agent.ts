/**
 * The assistant's agent loop (issue #62, step 3). Our own code, no agent
 * framework: ask the provider for a turn, run the tools it calls, feed the
 * results back, until it answers without tools or a step limit is reached.
 *
 * Read-only: the tools are the read tools in `tools.ts`. Writes arrive in step
 * 6 as confirmed actions in the UI, never as tools the model can call.
 */
import type { A2uiMessage } from "@clock-compass/assistant-catalog";
import type { AiJobs } from "../ai/jobs.js";
import type { AgentMessage, AiProvider, AssistantTurnEvent, ToolResultMessage } from "../ai/provider.js";
import { currentDataPolicy, type DataCategory, type DataPolicy } from "./data-policy.js";
import {
  READ_TOOLS,
  isTimeZone,
  runTool,
  toolSpecs,
  type AssistantServices,
  type AssistantTool,
} from "./tools.js";
import { MAX_RENDER_FAILURES, RENDER_TOOL, RENDER_TOOL_NAME, renderInstructions, renderSurface } from "./render.js";

export type DoneReason = "end" | "step-limit" | "max_tokens" | "refusal" | "other";

/** What the loop reports while it runs, in order. */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool-call"; id: string; name: string; args: unknown }
  | { type: "tool-result"; id: string; name: string; ok: boolean; error?: string }
  /** A validated A2UI surface to show, from a render_a2ui call (`id` is the call's). */
  | { type: "surface"; id: string; surfaceId: string; messages: A2uiMessage[] }
  /** A message added to the conversation (assistant turns and tool results). */
  | { type: "message"; message: AgentMessage }
  | { type: "done"; reason: DoneReason };

export type UnavailableReason = "no-provider" | "unsupported-provider" | "not-ready";

/** The assistant cannot run: no AI configured, a provider without it (Codex), or not signed in. */
export class AssistantUnavailableError extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(
      reason === "no-provider"
        ? "The assistant is unavailable: no AI provider is configured on the server."
        : reason === "unsupported-provider"
          ? "The assistant is unavailable with the configured AI provider."
          : "The assistant is unavailable: the AI provider is not connected yet.",
    );
    this.name = "AssistantUnavailableError";
  }
}

export interface AgentOptions {
  jobs: AiJobs;
  services: AssistantServices;
  /** Defaults to the policy in force (`currentDataPolicy`). */
  policy?: DataPolicy;
  /** Defaults to the read tools. */
  tools?: AssistantTool[];
  /** Model turns per run, tool round-trips included. Default 8. */
  maxSteps?: number;
  maxTokens?: number;
  now?: () => Date;
  /**
   * The user's IANA time zone, from the client; days (scheduled days, today)
   * are the user's. An unknown zone falls back to the server's.
   */
  timeZone?: string;
  /** Offer the render_a2ui tool: answers may include validated A2UI surfaces. */
  ui?: boolean;
  /** Called when a tool's service fails (for the server's log). */
  onToolError?: (tool: string, error: unknown) => void;
}

export interface AgentRun {
  system: string;
  /** The conversation so far, ending with the user's new message. */
  history: AgentMessage[];
  signal?: AbortSignal;
}

/** Longest tool result passed to the model, in characters. */
const MAX_TOOL_RESULT = 60_000;

/** The provider the assistant job runs on, if it can run the assistant now. */
export async function assistantProvider(jobs: AiJobs): Promise<AiProvider> {
  const { provider } = jobs.forJob("assistant");
  if (!provider.available) throw new AssistantUnavailableError("no-provider");
  if (!provider.assistantTurn) throw new AssistantUnavailableError("unsupported-provider");
  if (provider.ready && !(await provider.ready())) throw new AssistantUnavailableError("not-ready");
  return provider;
}

/** Whether the assistant can run, without throwing. */
export async function assistantAvailability(
  jobs: AiJobs,
): Promise<{ available: true } | { available: false; reason: UnavailableReason }> {
  try {
    await assistantProvider(jobs);
    return { available: true };
  } catch (err) {
    if (err instanceof AssistantUnavailableError) return { available: false, reason: err.reason };
    throw err;
  }
}

/**
 * Runs the assistant on a conversation. Throws AssistantUnavailableError
 * before anything is yielded when the assistant cannot run; provider errors
 * during a run propagate to the caller (the AG-UI route turns them into an
 * error event).
 */
export async function* runAgent(options: AgentOptions, run: AgentRun): AsyncIterable<AgentEvent> {
  const provider = await assistantProvider(options.jobs);
  const policy = options.policy ?? currentDataPolicy();
  const tools = options.tools ?? READ_TOOLS;
  const specs = [...toolSpecs(tools, policy), ...(options.ui ? [RENDER_TOOL] : [])];
  let renderFailures = 0;
  const maxSteps = options.maxSteps ?? 8;
  const now = options.now ?? (() => new Date());
  const timeZone = isTimeZone(options.timeZone)
    ? options.timeZone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const messages: AgentMessage[] = [...run.history];

  for (let step = 0; step < maxSteps; step++) {
    let end: Extract<AssistantTurnEvent, { type: "turn-end" }> | undefined;
    for await (const event of provider.assistantTurn!({
      system: run.system,
      messages,
      tools: specs,
      maxTokens: options.maxTokens,
      signal: run.signal,
    })) {
      if (event.type === "text") yield { type: "text", delta: event.delta };
      else end = event;
    }
    if (!end) throw new Error("The AI provider ended a turn without a result.");

    messages.push(end.message);
    yield { type: "message", message: end.message };

    // A truncated or refused turn may carry a cut-off tool call: never run it.
    if (end.stopReason === "max_tokens" || end.stopReason === "refusal") {
      yield { type: "done", reason: end.stopReason };
      return;
    }
    if (end.message.toolCalls.length === 0) {
      yield { type: "done", reason: end.stopReason === "end" ? "end" : "other" };
      return;
    }

    const context = { services: options.services, policy, now: now(), timeZone, onToolError: options.onToolError };
    for (const call of end.message.toolCalls) {
      yield { type: "tool-call", id: call.id, name: call.name, args: call.args };
      if (options.ui && call.name === RENDER_TOOL_NAME) {
        const rendered = renderFailures >= MAX_RENDER_FAILURES ? undefined : renderSurface(call.args);
        if (rendered?.ok) yield { type: "surface", id: call.id, surfaceId: rendered.surfaceId, messages: rendered.messages };
        else renderFailures++;
        const error = rendered
          ? rendered.ok
            ? undefined
            : renderFailures >= MAX_RENDER_FAILURES
              ? `The screen was not shown: ${rendered.errors.join("; ")}. Do not try again; answer in plain text.`
              : `The screen was not shown: ${rendered.errors.join("; ")}. Fix these and call ${RENDER_TOOL_NAME} again, or answer in plain text.`
          : "Screens are off for the rest of this answer. Answer in plain text.";
        const result: ToolResultMessage = {
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(rendered?.ok ? { status: "shown", surfaceId: rendered.surfaceId } : { error }),
          ...(rendered?.ok ? {} : { isError: true }),
        };
        messages.push(result);
        yield { type: "tool-result", id: call.id, name: call.name, ok: !!rendered?.ok, ...(error ? { error } : {}) };
        yield { type: "message", message: result };
        continue;
      }
      const outcome = await runTool(tools, call.name, call.args, context);
      const result: ToolResultMessage = {
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: outcome.ok ? capped(JSON.stringify(outcome.result ?? null)) : JSON.stringify({ error: outcome.error }),
        ...(outcome.ok ? {} : { isError: true }),
      };
      messages.push(result);
      yield { type: "tool-result", id: call.id, name: call.name, ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) };
      yield { type: "message", message: result };
    }
  }
  yield { type: "done", reason: "step-limit" };
}

function capped(json: string): string {
  if (json.length <= MAX_TOOL_RESULT) return json;
  return JSON.stringify({
    truncated: true,
    note: `The result was ${json.length} characters; only the start is shown. Ask with a narrower filter.`,
    partial: json.slice(0, MAX_TOOL_RESULT),
  });
}

/** What the assistant is told about data it cannot see, from the policy. */
export function withheldData(policy: DataPolicy): string[] {
  const labels: Record<DataCategory, string> = {
    tasks: "tasks",
    taskNotes: "notes on tasks",
    goalsAndProjects: "goals, projects and roles",
    mission: "the mission statement",
    people: "people and relationship commitments",
    personNotes: "notes on people",
    ebaBalance: "emotional-bank-account balances",
    ebaEntryNotes: "emotional-bank-account entries and their notes",
    habitsAndRenewal: "habits and renewal",
  };
  return (Object.keys(labels) as DataCategory[]).filter((c) => !policy[c]).map((c) => labels[c]);
}

/**
 * The assistant's system prompt. The fixed part comes first (role, rules, the
 * data not shared, the A2UI catalog) and what changes every day or screen
 * comes last, so the provider can cache the long prefix. `view` is the screen
 * the user has open (from the client, untrusted: trimmed and quoted, never
 * instructions).
 */
export function assistantSystemPrompt(input: {
  today: string;
  view?: string;
  policy?: DataPolicy;
  /** Describe the render_a2ui tool and the catalog (when the run offers it). */
  ui?: boolean;
  /** Said when the client's time zone was unknown and the server's is used. */
  timeZoneNote?: string;
}): string {
  const policy = input.policy ?? currentDataPolicy();
  const withheld = withheldData(policy);
  const view = input.view?.replace(/[\r\n]+/g, " ").slice(0, 200);
  return [
    "You are the assistant inside Clock & Compass, a personal planner built on the principles of The 7 Habits of Highly Effective People: put first things first (Quadrant II, the big rocks), begin with the end in mind (mission, roles, goals), keep relationship commitments, and sharpen the saw (renewal).",
    "Use the tools to read the user's data before answering; never guess at tasks, goals, people or habits. Refer to items by their titles, not their ids.",
    "You can only read. You cannot create, change or complete anything yourself; when something should change, say what you suggest and the user can do it in the app.",
    withheld.length
      ? `Not shared with you by the user's settings: ${withheld.join(", ")}. Do not ask for it.`
      : "",
    "Be brief and warm, like a candid coach. Write plain text, no Markdown tables.",
    input.ui ? renderInstructions() : "",
    `Today is ${input.today}.${input.timeZoneNote ? ` ${input.timeZoneNote}` : ""}`,
    view ? `The user is looking at this screen: "${view}".` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
