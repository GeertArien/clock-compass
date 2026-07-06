import type { ProactivityTag } from "@prisma/client";
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

export interface OpenAiCompatibleOptions {
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 (Ollama). */
  baseUrl: string;
  /** Optional — local runtimes usually need none. */
  apiKey?: string;
  /** Required: model name as the endpoint knows it (gpt-…, llama…, etc.). */
  model: string;
}

/**
 * A provider for ANY endpoint speaking the OpenAI-compatible chat-completions
 * protocol: OpenAI itself, local runtimes (Ollama, LM Studio, vLLM), and
 * gateways (OpenRouter, LiteLLM). Plain fetch — deliberately no framework;
 * the AiProvider interface is the app's abstraction layer.
 *
 * Structured replies use `response_format: {type: "json_object"}` (the widely
 * supported subset) with the shape spelled out in the prompt, then validated
 * here — strict json_schema mode isn't available on most local runtimes.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly available = true;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(options: OpenAiCompatibleOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  private async chat(system: string, user: string, json: boolean): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(`AI provider error ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) {
      throw new Error("AI returned no content");
    }
    return content.trim();
  }

  async classifyTask(text: string, today: string): Promise<TaskClassification> {
    // json_object mode doesn't enforce the schema — validate the essentials.
    const raw = JSON.parse(
      await this.chat(
        `${CLASSIFY_SYSTEM}\n\n${CLASSIFY_JSON_SHAPE}`,
        `Current date: ${today}\n\nTask sentence: ${text}`,
        true,
      ),
    );
    return parseClassification(raw, text);
  }

  async tagProactivity(title: string, notes?: string | null): Promise<ProactivityTag> {
    const raw = JSON.parse(
      await this.chat(
        `${CLASSIFY_SYSTEM}\n\n${PROACTIVITY_JSON_SHAPE}`,
        `Tag this task as INFLUENCE or CONCERN.\nTitle: ${title}${notes ? `\nNotes: ${notes}` : ""}`,
        true,
      ),
    );
    return parseProactivity(raw);
  }

  refineMission(draft: string): Promise<string> {
    return this.chat(MISSION_SYSTEM, draft, false);
  }

  weeklyReview(context: WeeklyReviewContext): Promise<string> {
    return this.chat(REVIEW_SYSTEM, JSON.stringify(context, null, 2), false);
  }
}
