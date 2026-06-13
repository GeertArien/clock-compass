import type { ProactivityTag } from "@prisma/client";
import type { TaskClassification } from "./provider.js";

// Providers that can't guarantee a strict JSON schema (the OpenAI-compatible
// endpoint, the Codex responses backend) ask for JSON in the prompt and then
// validate the essentials here. Modeled once and shared so both providers agree
// on what a safe, fully-populated classification looks like.

/** Coerce a loosely-typed model reply into a safe TaskClassification. */
export function parseClassification(
  raw: unknown,
  fallbackTitle: string,
): TaskClassification {
  const obj = (raw ?? {}) as Partial<TaskClassification>;
  return {
    title: typeof obj.title === "string" && obj.title ? obj.title : fallbackTitle,
    important: obj.important === true,
    urgent: obj.urgent === true,
    proactivity:
      obj.proactivity === "INFLUENCE" || obj.proactivity === "CONCERN"
        ? obj.proactivity
        : null,
    dueDate:
      typeof obj.dueDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(obj.dueDate)
        ? obj.dueDate
        : null,
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
  };
}

/** Coerce a loosely-typed model reply into a proactivity tag (defaults INFLUENCE). */
export function parseProactivity(raw: unknown): ProactivityTag {
  const value = (raw as { proactivity?: unknown })?.proactivity;
  return value === "CONCERN" ? "CONCERN" : "INFLUENCE";
}
