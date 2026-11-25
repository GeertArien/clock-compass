/**
 * Proposals confirmed in the MCP App page (#118, step 3). React-free.
 *
 * A `propose_changes` result carries, for each change, the app's sentence,
 * its task changes and the exact arguments of the write (the input, the
 * server's idempotency key of a create, and the server's proof that it showed
 * this change). This module is the ConfirmBar's host in the page: the bar
 * shows the sentence; a press on Confirm sends those arguments, untouched,
 * to the change's tool through the MCP host. The page makes nothing up: what
 * it sends is what the server showed, and the server refuses anything else.
 *
 * What a Confirm calls through the host, and nothing more:
 * 1. the write (one `tools/call`);
 * 2. the read tools of this screen whose data the change touches
 *    (`refreshReads`; none when the screen shows no task cards);
 * 3. where the host offers it, `ui/update-model-context` (not a tool call),
 *    so the conversation knows what the user confirmed.
 * "Not now" calls nothing.
 */
import type { QueryClient } from "@tanstack/react-query";
import { DISMISSED_CHANGE_EVENT, PROPOSED_CHANGE_EVENT, type TaskChange, type Touches } from "@clock-compass/assistant-catalog";
import type { Goal, Project, Task } from "@clock-compass/web-client/api";
import type { ConfirmHost, ConfirmState } from "@/assistant/a2ui/components";
import { goalsQuery } from "@/lib/queries/goals";
import { projectsQuery } from "@/lib/queries/projects";
import { tasksQuery } from "@/lib/queries/tasks";
import { refreshReads, type HostReader, type ScreenRead } from "./data";

/** One change of a `propose_changes` result (`structuredContent.changes`, built in core). */
export interface ProposedChange {
  id: string;
  operation: string;
  tool: string;
  sentence: string;
  arguments: Record<string, unknown>;
  taskChanges: TaskChange[];
  touches: readonly Touches[];
  createsTitle?: string;
}

/** What the page needs of the host: the SDK `App`'s tool calls and, where offered, the model context. */
export interface ProposalHostPort extends HostReader {
  callServerTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    isError?: boolean;
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
  }>;
  /** Tells the host's model what happened; absent when the host does not offer it. */
  tellModel?(text: string): Promise<unknown>;
}

/** Which of a screen's reads show what a change touches. */
const READ_TOUCHES: Record<string, readonly Touches[]> = {
  listTasks: ["tasks"],
  getCompass: ["goals", "projects", "mission"],
  listHabits: ["habits"],
};

export const NO_ANSWER =
  "The answer did not arrive, so it may or may not have been done. Confirm again to make sure: it will not happen twice.";

const errorText = (content: unknown[] | undefined) =>
  (content ?? [])
    .map((c) => (c as { text?: unknown }).text)
    .filter((t): t is string => typeof t === "string")
    .join(" ")
    .trim();

export interface PageProposals {
  /** The ConfirmBars' host (ConfirmHostContext). */
  host: ConfirmHost;
  /** The renderer's action listener: a press on Confirm. */
  onAction(action: { name: string; context?: Record<string, unknown> }): void;
  /** Runs one change (also what onAction calls); resolves once it and its refresh are done. */
  confirm(changeId: string): Promise<void>;
}

/** The proposals of one `propose_changes` result. */
export function createPageProposals(changes: readonly ProposedChange[], reads: readonly ScreenRead[], port: ProposalHostPort, client: QueryClient): PageProposals {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const states = new Map<string, ConfirmState>();
  const listeners = new Set<() => void>();
  const set = (id: string, state: ConfirmState) => {
    states.set(id, state);
    for (const l of listeners) l();
  };
  const changeOf = (event: { name: string; context?: Record<string, unknown> }) =>
    event.name === PROPOSED_CHANGE_EVENT && typeof event.context?.change === "string" ? byId.get(event.context.change) : undefined;

  async function confirm(id: string): Promise<void> {
    const change = byId.get(id);
    const now = states.get(id)?.status;
    if (!change || now === "running" || now === "applied") return;
    set(id, { status: "running" });
    let answer: Awaited<ReturnType<ProposalHostPort["callServerTool"]>>;
    try {
      answer = await port.callServerTool({ name: change.tool, arguments: change.arguments });
    } catch {
      // Declined by the host, or no answer: a create may have happened; the
      // server's key makes a second press safe.
      return set(id, { status: "failed", error: NO_ANSWER });
    }
    if (answer.isError) return set(id, { status: "failed", error: errorText(answer.content) || "This was not done." });
    const { changed, id: createdId } = (answer.structuredContent ?? {}) as { changed?: unknown; id?: unknown };
    const already = changed === 0;
    const touched = reads.filter((r) => READ_TOUCHES[r.name]?.some((t) => change.touches.includes(t)));
    // Read again before saying "Done", so the cards show the change when it does.
    await refreshReads(port, client, touched);
    set(id, { status: "applied", ...(typeof createdId === "string" ? { createdId } : {}), ...(already ? { already: true } : {}) });
    await port.tellModel?.(`The user confirmed: ${change.sentence}${already ? " (it was already so; nothing changed)" : ""}.`)?.catch(() => undefined);
  }

  const host: ConfirmHost = {
    preview(event) {
      const change = changeOf(event);
      return change ? { key: change.id, text: change.sentence } : null;
    },
    taskChanges(event) {
      const change = changeOf(event);
      return change ? { key: change.id, changes: change.taskChanges } : null;
    },
    dismiss: (key) => set(key, { status: "dismissed" }),
    stateOf: (key) => states.get(key),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    createdName(id) {
      const fromCache =
        client.getQueryData<Task[]>(tasksQuery.queryKey)?.find((t) => t.id === id)?.title ??
        client.getQueryData<Goal[]>(goalsQuery.queryKey)?.find((g) => g.id === id)?.title ??
        client.getQueryData<Project[]>(projectsQuery.queryKey)?.find((p) => p.id === id)?.name;
      if (fromCache !== undefined) return fromCache;
      const made = changes.find((c) => {
        const state = states.get(c.id);
        return state?.status === "applied" && state.createdId === id;
      });
      return made?.createsTitle;
    },
  };

  return {
    host,
    confirm,
    onAction(action) {
      // "Not now" was recorded by the bar (host.dismiss): nothing to send.
      if (action.name === DISMISSED_CHANGE_EVENT) return;
      const change = changeOf(action);
      if (change) void confirm(change.id);
    },
  };
}
