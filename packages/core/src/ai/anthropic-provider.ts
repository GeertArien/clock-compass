import Anthropic from "@anthropic-ai/sdk";
import type { ProactivityTag } from "@prisma/client";
import type {
  AgentMessage,
  AiProvider,
  AssistantMessage,
  AssistantTurnEvent,
  AssistantTurnRequest,
  TaskClassification,
  ToolCall,
  TurnStopReason,
  WeeklyReviewContext,
} from "./provider.js";
import { CLASSIFY_SYSTEM, MISSION_SYSTEM, REVIEW_SYSTEM } from "./prompts.js";

const DEFAULT_MODEL = "claude-opus-4-8";

const CLASSIFY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "important", "urgent", "proactivity", "dueDate", "rationale"],
  properties: {
    title: { type: "string", description: "Cleaned-up imperative task title" },
    important: { type: "boolean" },
    urgent: { type: "boolean" },
    proactivity: { type: ["string", "null"], enum: ["INFLUENCE", "CONCERN", null] },
    dueDate: {
      type: ["string", "null"],
      description: "ISO date (YYYY-MM-DD) implied by the sentence, else null",
    },
    rationale: { type: "string", description: "One short sentence on the judgment" },
  },
} as const;

const PROACTIVITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proactivity"],
  properties: {
    proactivity: { type: "string", enum: ["INFLUENCE", "CONCERN"] },
  },
} as const;

/** Server-side Anthropic implementation. Key comes from the environment, never code. */
export class AnthropicAiProvider implements AiProvider {
  readonly available = true;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: { apiKey: string; model?: string; baseUrl?: string; fetch?: typeof fetch; maxRetries?: number }) {
    // `fetch`: the settings pass one that refuses redirects (#94), so the key
    // never follows one to another host; tests pass recorded SSE.
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  /** One structured-output call; the JSON schema guarantees a parseable reply. */
  private async structured<T>(
    system: string,
    user: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("AI returned no text content");
    }
    return JSON.parse(block.text) as T;
  }

  private async prose(system: string, user: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("AI returned no text content");
    }
    return block.text.trim();
  }

  classifyTask(text: string, today: string): Promise<TaskClassification> {
    return this.structured<TaskClassification>(
      CLASSIFY_SYSTEM,
      `Current date: ${today}\n\nTask sentence: ${text}`,
      CLASSIFY_SCHEMA,
    );
  }

  async tagProactivity(
    title: string,
    notes?: string | null,
  ): Promise<ProactivityTag> {
    const result = await this.structured<{ proactivity: ProactivityTag }>(
      CLASSIFY_SYSTEM,
      `Tag this task as INFLUENCE or CONCERN.\nTitle: ${title}${notes ? `\nNotes: ${notes}` : ""}`,
      PROACTIVITY_SCHEMA,
    );
    return result.proactivity;
  }

  refineMission(draft: string): Promise<string> {
    return this.prose(MISSION_SYSTEM, draft);
  }

  weeklyReview(context: WeeklyReviewContext): Promise<string> {
    return this.prose(REVIEW_SYSTEM, JSON.stringify(context, null, 2));
  }

  /**
   * One streamed assistant turn with tool calling. Text deltas are yielded as
   * they arrive; tool calls and the stop reason come from the final message.
   * The final content blocks (thinking included, when the model thinks) are
   * kept as providerData and replayed unchanged on the next turn, which keeps
   * tool-use turns valid on models that think.
   */
  async *assistantTurn(request: AssistantTurnRequest): AsyncIterable<AssistantTurnEvent> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: request.maxTokens ?? 16000,
        // Cache the prompt prefix (system prompt with the catalog, tools, the
        // conversation so far): each tool round-trip resends all of it.
        cache_control: { type: "ephemeral" },
        // The fixed prompt is its own block with its own cache breakpoint, so
        // it stays cached when the tail (date, screen) changes between answers.
        system: [
          { type: "text", text: request.system, cache_control: { type: "ephemeral" } },
          ...(request.systemTail ? [{ type: "text" as const, text: request.systemTail }] : []),
        ],
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
        })),
        messages: toAnthropicMessages(request.messages),
      },
      { signal: request.signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", delta: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    const text = final.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    const toolCalls: ToolCall[] = final.content.flatMap((block) =>
      block.type === "tool_use" ? [{ id: block.id, name: block.name, args: block.input }] : [],
    );
    const message: AssistantMessage = { role: "assistant", text, toolCalls, providerData: final.content };
    yield { type: "turn-end", message, stopReason: stopReasonOf(final.stop_reason) };
  }
}

function stopReasonOf(reason: string | null): TurnStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

/**
 * The neutral conversation as Anthropic messages. Consecutive tool results
 * become ONE user message of tool_result blocks (as the API expects for
 * parallel calls); an assistant turn replays its own content blocks when it
 * has them.
 */
export function toAnthropicMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      const content = Array.isArray(message.providerData)
        ? (message.providerData as Anthropic.ContentBlockParam[])
        : [
            ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
            ...message.toolCalls.map((call) => ({
              type: "tool_use" as const,
              id: call.id,
              name: call.name,
              input: call.args,
            })),
          ];
      out.push({ role: "assistant", content });
    } else {
      const block: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError ? { is_error: true } : {}),
      };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}
