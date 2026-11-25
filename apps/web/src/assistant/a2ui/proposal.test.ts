import { describe, expect, it } from "vitest";
import { MessageProcessor, type ComponentApi } from "@a2ui/web_core/v1_0";
import { acceptFinalEnvelopeKeys, ccApiCatalog, parseAction, type ActionLookup } from "@clock-compass/assistant-catalog";
import { scheduleProposal, weekPlan } from "@clock-compass/assistant-catalog/fixtures";
import type { Task } from "@clock-compass/web-client/api";
import { applyTaskChange, pendingTaskSet, type ProposalHost } from "./proposal";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Buitenkraan afsluiten",
  notes: null,
  important: true,
  urgent: true,
  quadrant: "Q1",
  status: "TODO",
  proactivity: null,
  isBigRock: false,
  plannedWeek: null,
  dueDate: null,
  completedAt: null,
  scheduledDay: null,
  scheduledTime: null,
  goalId: null,
  projectId: null,
  showFrom: null,
  later: false,
  recurrence: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...over,
});

/** The catalog's changes for one action, as the sheet's host reads them. */
const changesOf = (name: string, context: Record<string, unknown>, lookup: ActionLookup = { name: () => "x", pinnedTaskIds: () => [] }) => {
  const parsed = parseAction({ name, surfaceId: "s", context });
  if (parsed.kind !== "write") throw new Error("not a write");
  return parsed.taskChanges(lookup);
};

describe("the card shows the task as it would be after Confirm (#145)", () => {
  it("updateTask, the owner's case: not urgent, due 1 Nov 2027, yearly, shown from 11 Oct", () => {
    const [change] = changesOf("updateTask", { taskId: "t1", urgent: false, dueDate: "2027-11-01", repeat: { unit: "YEAR", leadDays: 21 } });
    const { after, changed } = applyTaskChange(task(), change!.set);
    expect(after).toMatchObject({
      urgent: false,
      quadrant: "Q2",
      dueDate: "2027-11-01T00:00:00.000Z",
      showFrom: "2027-10-11T00:00:00.000Z",
      recurrence: { unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21, active: true },
    });
    expect([...changed].sort()).toEqual(["due", "repeat", "showFrom", "urgent"]);
  });

  it("marks only what differs from the task as it is", () => {
    const { after, changed } = applyTaskChange(task({ urgent: false, quadrant: "Q2" }), { urgent: false, important: true });
    expect(changed.size).toBe(0);
    expect(after.quadrant).toBe("Q2");
  });

  it("scheduleTask: the day and the time; taken off the Clock clears the time", () => {
    const [on] = changesOf("scheduleTask", { taskId: "t1", day: "2026-11-26", time: "09:00" });
    expect(applyTaskChange(task(), on!.set)).toMatchObject({
      after: { scheduledDay: "2026-11-26T00:00:00.000Z", scheduledTime: "09:00" },
      changed: new Set(["scheduled"]),
    });
    const [off] = changesOf("scheduleTask", { taskId: "t1", day: null });
    const scheduled = task({ scheduledDay: "2026-11-26T00:00:00.000Z", scheduledTime: "09:00" });
    expect(applyTaskChange(scheduled, off!.set).after).toMatchObject({ scheduledDay: null, scheduledTime: null });
  });

  it("setTaskDone and setBigRock", () => {
    const [done] = changesOf("setTaskDone", { taskId: "t1", done: true });
    expect(applyTaskChange(task(), done!.set)).toMatchObject({ after: { status: "DONE" }, changed: new Set(["done"]) });
    const [rock] = changesOf("setBigRock", { taskId: "t1", bigRock: true });
    expect(applyTaskChange(task({ urgent: false, quadrant: "Q2" }), rock!.set)).toMatchObject({
      after: { isBigRock: true },
      changed: new Set(["bigRock"]),
    });
  });

  it("acceptWeekPlan: the plan's rocks pinned, the other open rock unpinned", () => {
    const lookup: ActionLookup = { name: () => "x", pinnedTaskIds: () => ["t4"] };
    const changes = changesOf("acceptWeekPlan", { weekStart: "2026-11-23", taskIds: ["t2", "t3"] }, lookup);
    const byId = Object.fromEntries(changes.map((c) => [c.taskId, applyTaskChange(task({ id: c.taskId, isBigRock: c.taskId === "t4" }), c.set)]));
    expect(byId.t2!.after.isBigRock).toBe(true);
    expect(byId.t3!.after.isBigRock).toBe(true);
    expect(byId.t4!.after.isBigRock).toBe(false);
    expect(byId.t4!.changed).toEqual(new Set(["bigRock"]));
  });

  it("stopping a repeat marks the rule and clears the show-from date", () => {
    const repeating = task({
      dueDate: "2027-11-01T00:00:00.000Z",
      showFrom: "2027-10-11T00:00:00.000Z",
      recurrence: { unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21, active: true },
    });
    const [stop] = changesOf("updateTask", { taskId: "t1", repeat: null });
    const { after, changed } = applyTaskChange(repeating, stop!.set);
    expect(after.recurrence?.active).toBe(false);
    expect(after.showFrom).toBeNull();
    expect(changed).toEqual(new Set(["repeat", "showFrom"]));
  });
});

describe("which proposals in a surface are still pending", () => {
  const lookup: ActionLookup = { name: () => "x", pinnedTaskIds: () => ["t9"] };
  function host(states: Record<string, { status: string }> = {}): ProposalHost & { keys: string[] } {
    const keys: string[] = [];
    return {
      keys,
      taskChanges(event) {
        const parsed = parseAction(event);
        if (parsed.kind !== "write") return null;
        keys.push(parsed.key);
        return { key: parsed.key, changes: parsed.taskChanges(lookup) };
      },
      stateOf: (key) => states[key],
    };
  }
  /** A stored proposal (the fixtures predate #145) as the official core holds it. */
  function surfaceOf(messages: unknown[], id: string) {
    const processor = new MessageProcessor<ComponentApi>([ccApiCatalog]);
    processor.processMessages(acceptFinalEnvelopeKeys(messages as never) as never);
    return processor.model.surfacesMap.get(id)! as never;
  }

  it("reads a stored week plan: each named task, and the rock it would unpin", () => {
    const surface = surfaceOf(weekPlan(["t1", "t2"], "2026-11-23", "plan-1"), "plan-1");
    expect(pendingTaskSet(surface, host(), "t1")).toEqual({ bigRock: true });
    expect(pendingTaskSet(surface, host(), "t9")).toEqual({ bigRock: false });
    expect(pendingTaskSet(surface, host(), "t5")).toBeNull();
  });

  it("follows the user's edit of a bound day field", () => {
    const processor = new MessageProcessor<ComponentApi>([ccApiCatalog]);
    processor.processMessages(acceptFinalEnvelopeKeys(scheduleProposal("t1", "2026-11-25", "sched-1")) as never);
    const surface = processor.model.surfacesMap.get("sched-1")!;
    expect(pendingTaskSet(surface as never, host(), "t1")).toEqual({ scheduledDay: "2026-11-25", scheduledTime: null });
    surface.dataModel.set("/day", "2026-11-27");
    expect(pendingTaskSet(surface as never, host(), "t1")).toEqual({ scheduledDay: "2026-11-27", scheduledTime: null });
    // An impossible day is an invalid action: the bar shows why, the card stays live.
    surface.dataModel.set("/day", "2026-02-31");
    expect(pendingTaskSet(surface as never, host(), "t1")).toBeNull();
  });

  it("is no longer pending once applied, running or declined; still pending after a failed Confirm", () => {
    const surface = surfaceOf(weekPlan(["t1"], "2026-11-23", "plan-2"), "plan-2");
    const probe = host();
    pendingTaskSet(surface, probe, "t1");
    const [key] = probe.keys;
    for (const status of ["applied", "running", "dismissed"]) {
      expect(pendingTaskSet(surface, host({ [key!]: { status } }), "t1")).toBeNull();
    }
    expect(pendingTaskSet(surface, host({ [key!]: { status: "failed" } }), "t1")).toEqual({ bigRock: true });
  });
});
