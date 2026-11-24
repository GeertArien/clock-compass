import { beforeEach, describe, expect, it } from "vitest";
import { FakeTaskRepository } from "./fake-task-repository.js";
import { TaskService, groupByQuadrant, serverToday } from "./task-service.js";
import { dayAtUtc, isoWeekStart } from "../domain/week.js";

describe("TaskService", () => {
  let service: TaskService;

  beforeEach(() => {
    service = new TaskService(new FakeTaskRepository());
  });

  it("attaches the derived quadrant on create", async () => {
    const task = await service.create({
      title: "Write quarterly goals",
      important: true,
      urgent: false,
    });
    expect(task.quadrant).toBe("Q2");
  });

  it("re-derives the quadrant when importance/urgency change", async () => {
    const task = await service.create({ title: "Triage", important: false, urgent: true });
    expect(task.quadrant).toBe("Q3");
    const moved = await service.update(task.id, { important: true });
    expect(moved.quadrant).toBe("Q1");
  });

  it("marks done and reopens a task", async () => {
    const created = await service.create({ title: "Pay bill", urgent: true });
    const done = await service.complete(created.id);
    expect(done.status).toBe("DONE");
    expect(done.completedAt).toBeInstanceOf(Date);
    const reopened = await service.reopen(created.id);
    expect(reopened.status).toBe("TODO");
    expect(reopened.completedAt).toBeNull();
  });

  it("pins and clears a big rock for the current week", async () => {
    const created = await service.create({
      title: "Plan the week",
      important: true,
      urgent: false,
    });
    const pinned = await service.setBigRock(created.id, true);
    expect(pinned.isBigRock).toBe(true);
    expect(pinned.plannedWeek?.toISOString()).toBe(dayAtUtc(isoWeekStart(serverToday())).toISOString());

    const bigRocks = await service.bigRocks();
    expect(bigRocks.map((t) => t.id)).toContain(created.id);

    const cleared = await service.setBigRock(created.id, false);
    expect(cleared.isBigRock).toBe(false);
    expect(cleared.plannedWeek).toBeNull();
    expect(await service.bigRocks()).toHaveLength(0);
  });

  it("schedules a task into a day with an optional time, and unschedules it", async () => {
    const day = new Date("2026-06-13T00:00:00.000Z");
    const created = await service.create({ title: "Date night", scheduledDay: day });
    expect(created.scheduledDay?.getTime()).toBe(day.getTime());
    expect(created.scheduledTime).toBeNull();

    const timed = await service.update(created.id, { scheduledTime: "19:30" });
    expect(timed.scheduledTime).toBe("19:30");

    // Scheduling never touches the quadrant — urgency stays a human judgment.
    expect(timed.quadrant).toBe(created.quadrant);

    const unscheduled = await service.update(created.id, {
      scheduledDay: null,
      scheduledTime: null,
    });
    expect(unscheduled.scheduledDay).toBeNull();
    expect(unscheduled.scheduledTime).toBeNull();
  });

  it("lists created tasks and filters by status", async () => {
    const a = await service.create({ title: "A" });
    await service.create({ title: "B" });
    await service.complete(a.id);
    expect(await service.list()).toHaveLength(2);
    expect(await service.list({ status: "DONE" })).toHaveLength(1);
    expect(await service.list({ status: "TODO" })).toHaveLength(1);
  });

  it("removes a task", async () => {
    const created = await service.create({ title: "Temp" });
    await service.remove(created.id);
    expect(await service.get(created.id)).toBeNull();
  });
});

describe("groupByQuadrant", () => {
  it("buckets tasks into Q1-Q4", async () => {
    const service = new TaskService(new FakeTaskRepository());
    await service.create({ title: "q1", important: true, urgent: true });
    await service.create({ title: "q2", important: true, urgent: false });
    await service.create({ title: "q4", important: false, urgent: false });
    const groups = groupByQuadrant(await service.list());
    expect(groups.Q1).toHaveLength(1);
    expect(groups.Q2).toHaveLength(1);
    expect(groups.Q3).toHaveLength(0);
    expect(groups.Q4).toHaveLength(1);
  });
});
