/**
 * The executor's ports bound to the app: the data is read from the server
 * (and the query cache refreshed with it), and every write goes through the app's own
 * optimistic mutations, so a confirmed action shows on every screen at once
 * and fails the way an edit in the app fails (its patch dropped, a toast).
 * Each write is awaited: it resolves when the server confirmed it.
 */
import { MutationObserver } from "@tanstack/react-query";
import { updateTask, type Task } from "@clock-compass/web-client/api";
import { queryClient } from "@/lib/query-client";
import { editTask, taskEdits, tasksQuery, type TaskEdit } from "@/lib/queries/tasks";
import { habitsQuery, intentionsQuery, saveIntention, toggleHabitToday } from "@/lib/queries/renewal";
import type { ActionPorts, TaskChange } from "./actions";

/** Runs a task edit and fails when the task is no longer shown (editTask then sends nothing). */
async function runEdit(edit: TaskEdit): Promise<void> {
  const updated = await new MutationObserver(queryClient, editTask).mutate(edit);
  if (!updated) throw new Error("that task is no longer in the app");
}

/**
 * Read from the server, not the cache, when an action is carried out. The
 * cache never goes stale on its own (staleTime: Infinity), and a habit
 * check-off is a toggle on the server: deciding from a cached "not marked"
 * after it was marked elsewhere (another device, the MCP adapter) would
 * un-mark it. The same goes for rocks pinned elsewhere that a week plan must
 * unpin.
 */
export const livePorts: ActionPorts = {
  tasks: () => queryClient.fetchQuery({ ...tasksQuery, staleTime: 0 }),
  habits: () => queryClient.fetchQuery({ ...habitsQuery, staleTime: 0 }),
  intentions: () => queryClient.fetchQuery({ ...intentionsQuery, staleTime: 0 }),
  setTaskDone: (task: Task) => runEdit(taskEdits.toggleComplete(task)),
  updateTask: (task: Task, change: TaskChange) =>
    runEdit({ task, optimistic: change, request: () => updateTask(task.id, change) }),
  toggleHabitToday: async (habit) => {
    await new MutationObserver(queryClient, toggleHabitToday).mutate(habit);
  },
  setIntention: async (dimension, text) => {
    await new MutationObserver(queryClient, saveIntention).mutate({ dimension, text });
  },
};
