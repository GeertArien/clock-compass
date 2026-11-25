/**
 * The page's data port (#118, step 2): the read tools' answers mapped to the
 * app's own shapes, so the same components run in the app and in the page.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { Task } from "@clock-compass/web-client/api";
import { TaskCard } from "@/components/TaskCard";
import { goalsQuery } from "@/lib/queries/goals";
import { projectsQuery } from "@/lib/queries/projects";
import { habitsQuery } from "@/lib/queries/renewal";
import { tasksQuery } from "@/lib/queries/tasks";
import { createPageQueryClient, seedReads, taskFromRead, type ReadTask } from "./data";
import matrix from "./matrix-result.fixture.json";

const reads = matrix.structuredContent.reads;
const readTasks = (reads[0]!.result as { tasks: ReadTask[] }).tasks;

/** "Plan the garden" as the REST API answers it to the app (fields the card does not use set as they come). */
const restTask: Task = {
  id: "t1",
  title: "Plan the garden",
  notes: "Seeds first",
  important: true,
  urgent: false,
  quadrant: "Q2",
  status: "TODO",
  proactivity: null,
  isBigRock: true,
  plannedWeek: "2026-11-16",
  dueDate: "2026-11-27T00:00:00.000Z",
  completedAt: null,
  scheduledDay: "2026-11-21T00:00:00.000Z",
  scheduledTime: "09:00",
  goalId: "g1",
  projectId: null,
  showFrom: null,
  later: false,
  recurrence: null,
  createdAt: "2026-11-18T09:00:00.000Z",
  updatedAt: "2026-11-18T09:00:00.000Z",
};

const card = (client: QueryClient, task: Task) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <TaskCard task={task} />
    </QueryClientProvider>,
  );

describe("the page's data port", () => {
  it("maps a read task to the app's Task: days as the app stores them, the rule as the app reads it", () => {
    expect(taskFromRead(readTasks[0]!)).toMatchObject({
      id: "t1",
      dueDate: "2026-11-27T00:00:00.000Z",
      scheduledDay: "2026-11-21T00:00:00.000Z",
      scheduledTime: "09:00",
      isBigRock: true,
      recurrence: null,
    });
    expect(
      taskFromRead({ ...readTasks[0]!, repeat: { unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21 }, showFrom: "2027-10-11", later: true }),
    ).toMatchObject({ recurrence: { unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21, active: true }, showFrom: "2027-10-11T00:00:00.000Z", later: true });
  });

  it("draws the same task card from the app's REST answer and from the read tool's answer", () => {
    const page = createPageQueryClient();
    seedReads(page, reads);
    const app = createPageQueryClient();
    app.setQueryData(goalsQuery.queryKey, page.getQueryData(goalsQuery.queryKey));
    app.setQueryData(projectsQuery.queryKey, page.getQueryData(projectsQuery.queryKey));
    expect(card(page, taskFromRead(readTasks[0]!))).toBe(card(app, restTask));
  });

  it("fills every key the components read, empty when the screen sent nothing, so nothing is fetched", () => {
    const client = createPageQueryClient();
    seedReads(client, []);
    for (const key of [tasksQuery.queryKey, goalsQuery.queryKey, projectsQuery.queryKey, habitsQuery.queryKey]) {
      expect(client.getQueryData(key)).toEqual([]);
    }
    seedReads(client, reads);
    expect((client.getQueryData(tasksQuery.queryKey) as Task[]).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    // The matrix sends no habits: that key stays empty rather than unloaded.
    expect(client.getQueryData(habitsQuery.queryKey)).toEqual([]);
  });

  it("never fetches by itself: a component reading an unseeded key gets nothing, and no request goes out", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const client = createPageQueryClient();
    seedReads(client, []);
    await client.refetchQueries({ type: "all" });
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
