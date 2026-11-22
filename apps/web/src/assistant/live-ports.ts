/**
 * The executor's ports bound to the app: the data comes from the query cache
 * (fetched if not loaded yet), and every write goes through the app's own
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

export const livePorts: ActionPorts = {
  tasks: () => queryClient.ensureQueryData(tasksQuery),
  habits: () => queryClient.ensureQueryData(habitsQuery),
  intentions: () => queryClient.ensureQueryData(intentionsQuery),
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
