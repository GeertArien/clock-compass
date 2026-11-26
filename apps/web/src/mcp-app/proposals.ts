/**
 * Proposals confirmed in the MCP App page (#118 step 3, #159). React-free.
 *
 * A `propose_changes` result carries, for each change, the app's sentence,
 * its task changes and the arguments of the write (the input, the server's
 * idempotency key of a create, and the server's proof that it showed this
 * change). This module is the ConfirmBar's host in the page: the bar shows
 * the sentence; a press on Confirm sends the write through the MCP host.
 *
 * Editing (#159, owner decisions of 26 November 2026): a proposed createTask
 * or updateTask is drawn as the app's own task card (a new task from the
 * server's draft) whose pills, Influence / Concern and goal picker change the
 * proposal, and whose pencil opens the title, the dates and the project. An
 * edit changes only what this page will send; nothing is written before
 * Confirm. The server's proof leaves exactly those fields open and checks
 * them like any input; everything else is sent as the server showed it.
 *
 * What a Confirm calls through the host, and nothing more:
 * 1. the write (one `tools/call`), edited or not. Its answer carries the
 *    tasks it changed as `list_tasks` shows them, and the cards redraw from
 *    that: no read follows;
 * 2. where the host offers it, `ui/update-model-context` (not a tool call),
 *    so the conversation knows the final values and what the user changed.
 * "Not now" calls nothing.
 */
import type { QueryClient } from "@tanstack/react-query";
import {
  DISMISSED_CHANGE_EVENT,
  PROPOSED_CHANGE_EVENT,
  draftChange,
  editProblem,
  editableFields,
  editedInput,
  operation,
  operationSentence,
  ownerChanges,
  type ActionLookup,
  type LookupTask,
  type OperationName,
  type TaskChange,
  type TaskEdits,
  type Touches,
} from "@clock-compass/assistant-catalog";
import type { Goal, Project, Task } from "@clock-compass/web-client/api";
import type { CardEdit, ConfirmHost, ConfirmState } from "@/assistant/a2ui/components";
import { goalsQuery } from "@/lib/queries/goals";
import { projectsQuery } from "@/lib/queries/projects";
import { tasksQuery } from "@/lib/queries/tasks";
import { taskFromRead, type HostReader, type ReadTask } from "./data";

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
  /** A createTask: the task as it would be made, under a `draft-` id (#159). */
  draft?: ReadTask;
  /** An updateTask: the task as the server's sentence compared it (#159). */
  current?: LookupTask;
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

/**
 * The host threw instead of answering: in Open WebUI, Cancel in its own
 * dialog. Or the answer was lost after the write: a second press is safe
 * either way (the server accepts a proof once and answers the first result).
 */
export const NOT_CONFIRMED =
  "Not confirmed: this did not go through, or its answer did not arrive. Your changes to the card are kept. Press Confirm to try again; it will not happen twice.";

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
  /** Runs one change (also what onAction calls); resolves once it is done. */
  confirm(changeId: string): Promise<void>;
  /** Edits one change in its card (what the card's controls call). */
  edit(changeId: string, patch: TaskEdits): void;
}

export interface PageProposalOptions {
  /** What a card's pencil opens (the page passes its React fields); none in tests. */
  Fields?: CardEdit["Fields"];
}

/** Puts the drafts of proposed new tasks into the page's task cache, for their cards (#159). */
export function seedDrafts(client: QueryClient, changes: readonly ProposedChange[]): void {
  const drafts = changes.flatMap((c) => (c.draft ? [taskFromRead(c.draft)] : []));
  if (!drafts.length) return;
  client.setQueryData<Task[]>(tasksQuery.queryKey, (tasks = []) => [...tasks.filter((t) => !drafts.some((d) => d.id === t.id)), ...drafts]);
}

/** The proposals of one `propose_changes` result. */
export function createPageProposals(
  changes: readonly ProposedChange[],
  port: ProposalHostPort,
  client: QueryClient,
  options: PageProposalOptions = {},
): PageProposals {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const states = new Map<string, ConfirmState>();
  const edits = new Map<string, TaskEdits>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  const set = (id: string, state: ConfirmState) => {
    states.set(id, state);
    notify();
  };
  const changeOf = (event: { name: string; context?: Record<string, unknown> }) =>
    event.name === PROPOSED_CHANGE_EVENT && typeof event.context?.change === "string" ? byId.get(event.context.change) : undefined;

  // --- What a change is now, with the user's edits --------------------------------

  const cachedTasks = () => client.getQueryData<Task[]>(tasksQuery.queryKey) ?? [];
  /** The data a sentence names, from the page's cache (and the task as the server compared it). */
  const lookupOf = (change: ProposedChange): ActionLookup => ({
    name(kind, id) {
      if (kind === "task") return id === change.arguments.taskId && change.current ? change.current.title : cachedTasks().find((t) => t.id === id)?.title;
      if (kind === "project") return client.getQueryData<Project[]>(projectsQuery.queryKey)?.find((p) => p.id === id)?.name;
      if (kind === "goal") return client.getQueryData<Goal[]>(goalsQuery.queryKey)?.find((g) => g.id === id)?.title;
      return undefined;
    },
    pinnedTaskIds: () => cachedTasks().filter((t) => t.isBigRock && t.status === "TODO").map((t) => t.id),
    task: (id) => (id === change.arguments.taskId ? change.current : undefined),
  });
  const split = (change: ProposedChange) => {
    const { proposal, idempotencyKey, ...input } = change.arguments;
    return { proposal, idempotencyKey, input };
  };
  const editable = (change: ProposedChange) =>
    editableFields(change.operation).length > 0 && (change.operation !== "createTask" || !!change.draft) && (change.operation !== "updateTask" || !!change.current);
  const edited = (change: ProposedChange) => edits.has(change.id);
  /** The write's input as it will be sent: the proposed input with the user's edits. */
  const finalInput = (change: ProposedChange) => {
    const { input } = split(change);
    const e = edits.get(change.id);
    return e ? editedInput(change.operation, input, e) : input;
  };
  const finalArguments = (change: ProposedChange) => {
    if (!edited(change)) return change.arguments;
    const { proposal, idempotencyKey } = split(change);
    return { ...finalInput(change), ...(idempotencyKey !== undefined ? { idempotencyKey } : {}), proposal };
  };
  /** The app's sentence for the change as it is now: the server's own until the user edits it. */
  const sentenceOf = (change: ProposedChange) =>
    edited(change) ? operationSentence(operation(change.operation as OperationName), finalInput(change), lookupOf(change)) : change.sentence;
  const cardChanges = (change: ProposedChange): TaskChange[] => {
    if (change.draft) return [draftChange(change.draft.id, edits.get(change.id) ?? {})];
    if (!edited(change)) return change.taskChanges;
    return operation(change.operation as OperationName).taskChanges?.(finalInput(change), lookupOf(change)) ?? [];
  };

  function edit(id: string, patch: TaskEdits): void {
    const change = byId.get(id);
    const status = states.get(id)?.status;
    if (!change || !editable(change) || status === "running" || status === "applied" || status === "dismissed") return;
    const open = new Set<string>(editableFields(change.operation));
    const kept = Object.fromEntries(Object.entries(patch).filter(([field]) => open.has(field)));
    edits.set(id, { ...edits.get(id), ...kept });
    notify();
  }

  // --- Confirm: one call through the host ---------------------------------------------

  /** The tasks the write's answer carries, into the cache: the cards redraw from them. */
  function takeTasks(change: ProposedChange, answered: unknown, createdId: string | undefined) {
    if (!Array.isArray(answered)) return;
    const tasks = (answered as ReadTask[]).map(taskFromRead);
    client.setQueryData<Task[]>(tasksQuery.queryKey, (cached = []) => {
      const byTask = new Map(cached.map((t) => [t.id, t]));
      for (const t of tasks) byTask.set(t.id, t);
      // A new task's card is its draft's: it now shows the task as made.
      const made = createdId ? tasks.find((t) => t.id === createdId) : undefined;
      if (change.draft && made) byTask.set(change.draft.id, { ...made, id: change.draft.id });
      return [...byTask.values()];
    });
  }

  /** What the model is told: the final values, and what the user changed from its proposal. */
  function modelText(change: ProposedChange, sentence: string, createdId: string | undefined, already: boolean): string {
    const id = createdId ? ` (id ${createdId})` : "";
    const nothing = already ? " (it was already so; nothing changed)" : "";
    const changedByUser = edited(change) ? ownerChanges(change.operation, split(change).input, finalInput(change), lookupOf(change)) : [];
    if (!changedByUser.length) return `The user confirmed: ${sentence}${id}${nothing}.`;
    const list = changedByUser.map((c) => `${c.now} (you proposed ${c.proposed})`).join("; ");
    return `The user confirmed, with changes: ${sentence}${id}${nothing}. They changed: ${list}. Use these values, not the ones you proposed.`;
  }

  async function confirm(id: string): Promise<void> {
    const change = byId.get(id);
    const now = states.get(id)?.status;
    if (!change || now === "running" || now === "applied") return;
    if (editable(change) && editProblem(change.operation, finalInput(change), lookupOf(change))) return;
    const sentence = sentenceOf(change);
    set(id, { status: "running" });
    let answer: Awaited<ReturnType<ProposalHostPort["callServerTool"]>>;
    try {
      answer = await port.callServerTool({ name: change.tool, arguments: finalArguments(change) });
    } catch {
      return set(id, { status: "failed", error: NOT_CONFIRMED });
    }
    if (answer.isError) return set(id, { status: "failed", error: errorText(answer.content) || "This was not done." });
    const { changed, id: createdId, tasks } = (answer.structuredContent ?? {}) as { changed?: unknown; id?: unknown; tasks?: unknown };
    const already = changed === 0;
    const made = typeof createdId === "string" ? createdId : undefined;
    takeTasks(change, tasks, made);
    set(id, { status: "applied", ...(made ? { createdId: made } : {}), ...(already ? { already: true } : {}) });
    await port.tellModel?.(modelText(change, sentence, made, already))?.catch(() => undefined);
  }

  const drafts = new Set(changes.flatMap((c) => (c.draft ? [c.draft.id] : [])));

  const host: ConfirmHost = {
    preview(event) {
      const change = changeOf(event);
      if (!change) return null;
      const blocked = editable(change) ? editProblem(change.operation, finalInput(change), lookupOf(change)) : null;
      return { key: change.id, text: sentenceOf(change), ...(blocked ? { blocked } : {}) };
    },
    taskChanges(event) {
      const change = changeOf(event);
      return change ? { key: change.id, changes: cardChanges(change) } : null;
    },
    dismiss(key) {
      set(key, { status: "dismissed" });
      // A declined new task leaves no card behind.
      const draft = byId.get(key)?.draft;
      if (draft) client.setQueryData<Task[]>(tasksQuery.queryKey, (tasks = []) => tasks.filter((t) => t.id !== draft.id));
    },
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
      return made ? ((finalInput(made).title as string | undefined) ?? made.createsTitle) : undefined;
    },
    edit(key) {
      const change = byId.get(key);
      const status = states.get(key)?.status;
      if (!change || !editable(change) || status === "running" || status === "applied" || status === "dismissed") return null;
      return { set: (patch) => edit(key, patch as TaskEdits), ...(options.Fields ? { Fields: options.Fields } : {}) };
    },
    isDraft: (taskId) => drafts.has(taskId),
  };

  return {
    host,
    confirm,
    edit,
    onAction(action) {
      // "Not now" was recorded by the bar (host.dismiss): nothing to send.
      if (action.name === DISMISSED_CHANGE_EVENT) return;
      const change = changeOf(action);
      if (change) void confirm(change.id);
    },
  };
}
