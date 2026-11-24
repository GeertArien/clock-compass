/**
 * The assistant's read-only tools (issue #62, step 3; one set with MCP since
 * #117).
 *
 * The tools are the reads declared in `@clock-compass/assistant-catalog`
 * (`reads.ts`), answered by the handlers in `../reads/handlers.ts`: the same
 * names, arguments, data rules and answers the MCP adapter offers. This file
 * only fits them to the agent loop: the name the model sees (by the same rule
 * as the operations: listTasks → list_tasks), the JSON schema of the input,
 * and the outcome the loop feeds back. No tool writes anything; writes are
 * confirmed actions in the UI, never model tools.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { READ_LIST, mcpToolName, type DataCategory, type ReadDeclaration } from "@clock-compass/assistant-catalog";
import type { ToolSpec } from "../ai/provider.js";
import { runRead, type ReadOutcome, type ReadServices } from "../reads/handlers.js";
import type { DataPolicy } from "./data-policy.js";

export { localDay, personView, taskView } from "../reads/handlers.js";
export { isTimeZone } from "../domain/zoned.js";

/** The services the tools read from (a subset of what the MCP adapter wraps). */
export type AssistantServices = ReadServices;

export interface ToolContext {
  services: AssistantServices;
  policy: DataPolicy;
  now: Date;
  /** The user's IANA time zone (e.g. "Europe/Brussels"): days are theirs, not the server's. */
  timeZone: string;
  /** Called when a tool's service fails; the model only gets a generic error. */
  onToolError?: (tool: string, error: unknown) => void;
}

export interface AssistantTool {
  /** The name the model sees (`list_tasks`). */
  name: string;
  description: string;
  /** The data categories it reads; it is offered when at least one is on. */
  categories: readonly DataCategory[];
  /** The declaration it answers (`listTasks`). */
  read: ReadDeclaration;
}

/** The input schema of a read, as JSON schema for a provider's tool list. */
function jsonSchema(read: ReadDeclaration): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = zodToJsonSchema(read.input, { $refStrategy: "none" }) as Record<string, unknown>;
  return schema;
}

/** One set with MCP: every declared read, named by the operations' rule. */
export const READ_TOOLS: AssistantTool[] = READ_LIST.map((read) => ({
  name: mcpToolName(read.name),
  description: read.summary,
  categories: read.categories,
  read,
}));

const allowed = (tool: AssistantTool, policy: DataPolicy) => tool.categories.some((c) => policy[c]);

/** The tools the policy allows, as the model sees them. */
export function toolSpecs(tools: AssistantTool[], policy: DataPolicy): ToolSpec[] {
  return tools
    .filter((t) => allowed(t, policy))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: jsonSchema(t.read) }));
}

export type ToolOutcome = ReadOutcome;

/**
 * Runs one tool call from the model. Unknown tools, switched-off categories
 * and invalid arguments are reported back to the model as errors (it can
 * correct itself); a service failure is reported the same way, without
 * internals.
 */
export async function runTool(
  tools: AssistantTool[],
  name: string,
  args: unknown,
  context: ToolContext,
): Promise<ToolOutcome> {
  const found = tools.find((t) => t.name === name);
  if (!found) return { ok: false, error: `Unknown tool "${name}".` };
  if (!allowed(found, context.policy)) {
    return { ok: false, error: `"${name}" reads data the user has not shared with the assistant.` };
  }
  const outcome = await runRead(found.read.name, args, context.services, {
    policy: context.policy,
    now: context.now,
    timeZone: context.timeZone,
    onError: (_read, err) => context.onToolError?.(name, err),
  });
  if (outcome.ok) return outcome;
  // The handlers' words, with the tool's name as the model knows it.
  if (outcome.error.startsWith("Invalid arguments")) {
    return { ok: false, error: outcome.error.replace("Invalid arguments", `Invalid arguments for "${name}"`) };
  }
  if (outcome.error.startsWith("Reading that failed")) {
    return { ok: false, error: `"${name}" failed. Try again or answer without it.` };
  }
  return outcome;
}
