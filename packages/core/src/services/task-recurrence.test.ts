import { describe, expect, it } from "vitest";
import { FakeTaskRepository } from "./fake-task-repository.js";
import { TaskRuleError, TaskService, progressCounts, serverToday } from "./task-service.js";

/**
 * Recurring tasks (#105, step 1.b) through the real TaskService on the
 * in-memory repository. "Today" is the server's day of `now`; days are plain
 * dates. Brussels is the browser's zone where a scheduled day matters.
 */
const at = (iso: string) => new Date(iso);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const plain = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const brussels = { timeZone: "Europe/Brussels" };

function setup() {
  const repo = new FakeTaskRepository();
  return { repo, tasks: new TaskService(repo) };
}

const yearly = { unit: "YEAR" as const, leadDays: 21 };

describe("creating a repeating task", () => {
  it("makes a series anchored on the due date, with the slot and 'show from'", async () => {
    const { repo, tasks } = setup();
    const t = await tasks.create({ title: "Buitenkraan afsluiten", important: true, dueDate: day("2026-11-01"), recurrence: yearly }, { now: at("2026-10-01T12:00:00Z") });
    expect(t.recurrence).toEqual({ unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21, active: true });
    expect(plain(t.slotDate)).toBe("2026-11-01");
    expect(plain(t.showFrom)).toBe("2026-10-11");
    expect(t.later).toBe(true); // 1 October is before 11 October
    expect((await tasks.get(t.id, { now: at("2026-10-11T12:00:00Z") }))?.later).toBe(false);
    expect(repo.allSeries().map((s) => plain(s.anchorDate))).toEqual(["2026-11-01"]);
  });

  it("refuses a repeating task with no date to repeat", async () => {
    const { tasks } = setup();
    await expect(tasks.create({ title: "Someday", recurrence: { unit: "WEEK" } })).rejects.toThrow(TaskRuleError);
    await expect(tasks.create({ title: "x", dueDate: day("2026-11-01"), recurrence: { unit: "WEEK", every: 0 } })).rejects.toThrow(/every/);
  });

  it("leaves a task that does not repeat as it was", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Once" });
    expect(t).toMatchObject({ seriesId: null, previousId: null, slotDate: null, showFrom: null, later: false, recurrence: null });
  });
});

describe("completing an occurrence", () => {
  it("creates the next one with the carried fields and the next dates, once", async () => {
    const { tasks } = setup();
    const now = { now: at("2026-11-01T09:00:00Z") };
    const t = await tasks.create(
      { title: "Buitenkraan afsluiten", important: true, notes: "Hoofdkraan", proactivity: "INFLUENCE", dueDate: day("2026-11-01"), recurrence: yearly },
      now,
    );
    await tasks.update(t.id, { isBigRock: true });
    const done = await tasks.complete(t.id, now);
    expect(done.status).toBe("DONE");
    const open = (await tasks.list({ status: "TODO" }, now)).filter((x) => x.seriesId === t.seriesId);
    expect(open).toHaveLength(1);
    const next = open[0]!;
    expect(next).toMatchObject({ title: "Buitenkraan afsluiten", important: true, notes: "Hoofdkraan", proactivity: "INFLUENCE", isBigRock: false, previousId: t.id, later: true });
    expect([plain(next.dueDate), plain(next.slotDate), plain(next.showFrom)]).toEqual(["2027-11-01", "2027-11-01", "2027-10-11"]);
    // A target state: completing again changes nothing and makes no second occurrence.
    const again = await tasks.complete(t.id, { now: at("2026-11-02T09:00:00Z") });
    expect(again.completedAt?.toISOString()).toBe(done.completedAt?.toISOString());
    expect((await tasks.list({}, now)).length).toBe(2);
  });

  it("makes one next occurrence when the same completion arrives twice at once (two devices)", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Filter", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK" } });
    const now = { now: at("2026-11-02T09:00:00Z") };
    await Promise.all([tasks.complete(t.id, now), tasks.complete(t.id, now), tasks.complete(t.id, now)]);
    expect((await tasks.list({ status: "TODO" }, now)).map((x) => plain(x.dueDate))).toEqual(["2026-11-09"]);
  });

  it("on a fixed schedule, a late completion gives the first date after today, not a backlog", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK" } });
    await tasks.complete(t.id, { now: at("2026-11-24T18:00:00Z") });
    expect((await tasks.list({ status: "TODO" })).map((x) => plain(x.dueDate))).toEqual(["2026-11-30"]);
  });

  it("counted from completion, the next date is one cadence after the day it was done", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Change the filter", dueDate: day("2026-11-02"), recurrence: { unit: "MONTH", from: "COMPLETION" } });
    await tasks.complete(t.id, { now: at("2026-11-26T09:00:00Z") });
    expect((await tasks.list({ status: "TODO" })).map((x) => plain(x.dueDate))).toEqual(["2026-12-26"]);
  });

  it("carries a scheduled day at its distance to the due date, as a plain date, with its time (#136)", async () => {
    const { tasks } = setup();
    // Scheduled Thursday 29 Oct, due Sunday 1 Nov.
    const t = await tasks.create(
      { title: "Kraan", dueDate: day("2026-11-01"), scheduledDay: day("2026-10-29"), scheduledTime: "09:00", recurrence: { unit: "YEAR" } },
      brussels,
    );
    await tasks.complete(t.id, { ...brussels, now: at("2026-10-29T10:00:00Z") });
    const next = (await tasks.list({ status: "TODO" }))[0]!;
    expect(plain(next.dueDate)).toBe("2027-11-01");
    expect(next.scheduledDay?.toISOString()).toBe("2027-10-29T00:00:00.000Z"); // the same plain date in every zone
    expect(next.scheduledTime).toBe("09:00");
  });

  it("a Thursday occurrence completed with no zone (MCP, server in UTC) gets its next one on a Thursday (#116 case, #136)", async () => {
    const { tasks } = setup();
    const t = await tasks.create(
      { title: "Bins", scheduledDay: day("2026-11-26"), recurrence: { unit: "WEEK" } },
      { timeZone: "UTC" },
    );
    await tasks.complete(t.id, { timeZone: "UTC", now: at("2026-11-26T08:00:00Z") });
    const next = (await tasks.list({ status: "TODO" }))[0]!;
    expect(next.scheduledDay?.toISOString()).toBe("2026-12-03T00:00:00.000Z"); // Thursday
  });

  it("refuses a scheduled day that is not a plain date (#136)", async () => {
    const { tasks } = setup();
    await expect(tasks.create({ title: "x", scheduledDay: at("2026-11-25T23:00:00Z") })).rejects.toBeInstanceOf(TaskRuleError);
    const t = await tasks.create({ title: "y" });
    await expect(tasks.update(t.id, { scheduledDay: at("2026-11-25T23:00:00Z") })).rejects.toThrow(/plain date/);
  });

  it("completes a task that does not repeat as before, and creates nothing", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Once", dueDate: day("2026-11-01") });
    await tasks.complete(t.id);
    expect(await tasks.list({})).toHaveLength(1);
  });
});

describe("skipping, stopping, deleting", () => {
  it("skip: the occurrence is archived and left out of the lists, the next one comes from today", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK" } });
    const skipped = await tasks.skip(t.id, { now: at("2026-11-10T09:00:00Z") });
    expect(skipped.status).toBe("ARCHIVED");
    expect((await tasks.list({})).map((x) => plain(x.dueDate))).toEqual(["2026-11-16"]);
    expect(await tasks.list({ status: "ARCHIVED" })).toHaveLength(1);
    // The series history still has both.
    expect((await tasks.occurrences(t.seriesId!)).map((x) => x.status)).toEqual(["ARCHIVED", "TODO"]);
    // Skipping again is a no-op; skipping a task that does not repeat is refused.
    await tasks.skip(t.id);
    expect(await tasks.list({})).toHaveLength(1);
    const once = await tasks.create({ title: "Once" });
    await expect(tasks.skip(once.id)).rejects.toMatchObject({ status: 422 });
  });

  it("stop repeating: the open occurrence stays, nothing follows it", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK", leadDays: 2 } });
    const stopped = await tasks.update(t.id, { recurrence: null });
    expect(stopped.recurrence?.active).toBe(false);
    expect(stopped.showFrom).toBeNull();
    await tasks.complete(t.id, { now: at("2026-11-02T09:00:00Z") });
    expect(await tasks.list({ status: "TODO" })).toEqual([]);
  });

  it("deleting the open occurrence ends the series; done ones stay", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK" } });
    await tasks.complete(t.id, { now: at("2026-11-02T09:00:00Z") });
    const open = (await tasks.list({ status: "TODO" }))[0]!;
    await tasks.remove(open.id);
    const left = await tasks.list({});
    expect(left.map((x) => [x.id, x.status])).toEqual([[t.id, "DONE"]]);
    expect(left[0]!.recurrence?.active).toBe(false);
  });
});

describe("reopening a completed occurrence", () => {
  it("removes the next occurrence when it is still exactly as it was created", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK" } });
    await tasks.complete(t.id, { now: at("2026-11-02T09:00:00Z") });
    expect(await tasks.list({})).toHaveLength(2);
    const reopened = await tasks.reopen(t.id, { now: at("2026-11-03T09:00:00Z") });
    expect(reopened.status).toBe("TODO");
    expect((await tasks.list({})).map((x) => x.id)).toEqual([t.id]);
    // Reopening an open task is a no-op.
    await tasks.reopen(t.id);
    expect(await tasks.list({})).toHaveLength(1);
  });

  it("keeps a next occurrence that was changed, and completing again makes no second one", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK" } });
    await tasks.complete(t.id, { now: at("2026-11-02T09:00:00Z") });
    const next = (await tasks.list({ status: "TODO" }))[0]!;
    await tasks.update(next.id, { notes: "Glass too" });
    await tasks.reopen(t.id, { now: at("2026-11-03T09:00:00Z") });
    expect(await tasks.list({ status: "TODO" })).toHaveLength(2);
    await tasks.complete(t.id, { now: at("2026-11-05T09:00:00Z") });
    const open = await tasks.list({ status: "TODO" });
    expect(open.map((x) => x.id)).toEqual([next.id]);
  });

  it("counted from completion: done Monday, reopened, done Thursday counts from Thursday", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Water the plants", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK", from: "COMPLETION" } });
    await tasks.complete(t.id, { now: at("2026-11-02T09:00:00Z") });
    await tasks.reopen(t.id, { now: at("2026-11-02T10:00:00Z") });
    await tasks.complete(t.id, { now: at("2026-11-05T09:00:00Z") });
    expect((await tasks.list({ status: "TODO" })).map((x) => plain(x.dueDate))).toEqual(["2026-11-12"]);
  });

  it("a pinned or edited-date successor counts as changed", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02"), recurrence: { unit: "WEEK" } });
    await tasks.complete(t.id, { now: at("2026-11-02T09:00:00Z") });
    const next = (await tasks.list({ status: "TODO" }))[0]!;
    await tasks.update(next.id, { dueDate: day("2026-11-10") });
    await tasks.reopen(t.id);
    expect(await tasks.list({ status: "TODO" })).toHaveLength(2);
  });
});

describe("editing", () => {
  it("moving this occurrence's due date does not move the next one", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Kraan", dueDate: day("2026-11-01"), recurrence: yearly });
    const moved = await tasks.update(t.id, { dueDate: day("2026-11-05") });
    expect([plain(moved.slotDate), plain(moved.showFrom)]).toEqual(["2026-11-01", "2026-10-15"]);
    await tasks.complete(t.id, { now: at("2026-11-05T09:00:00Z") });
    expect((await tasks.list({ status: "TODO" })).map((x) => plain(x.dueDate))).toEqual(["2027-11-01"]);
  });

  it("a new rule counts from this occurrence on", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Kraan", dueDate: day("2026-11-01"), recurrence: yearly });
    const changed = await tasks.update(t.id, { dueDate: day("2026-10-15"), recurrence: { unit: "YEAR", leadDays: 7 } });
    expect([plain(changed.slotDate), plain(changed.showFrom)]).toEqual(["2026-10-15", "2026-10-08"]);
    await tasks.complete(t.id, { now: at("2026-10-15T09:00:00Z") });
    expect((await tasks.list({ status: "TODO" })).map((x) => plain(x.dueDate))).toEqual(["2027-10-15"]);
  });

  it("a rule set on a task already done creates its next occurrence now (the owner's case in #105)", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Buitenkraan afsluiten", dueDate: day("2026-11-01") });
    await tasks.complete(t.id, { now: at("2026-11-01T09:00:00Z") });
    await tasks.update(t.id, { recurrence: { unit: "YEAR", leadDays: 21 } }, { now: at("2026-11-24T09:00:00Z") });
    const open = await tasks.list({ status: "TODO" }, { now: at("2026-11-24T09:00:00Z") });
    expect(open.map((x) => [plain(x.dueDate), plain(x.showFrom), x.later, x.previousId])).toEqual([["2027-11-01", "2027-10-11", true, t.id]]);
    // Setting a rule again on the done one makes no second successor.
    await tasks.update(t.id, { recurrence: { unit: "YEAR", leadDays: 21 } });
    expect(await tasks.list({ status: "TODO" })).toHaveLength(1);
    // On an open task, a rule creates nothing until it is completed.
    const open2 = await tasks.create({ title: "Open one", dueDate: day("2026-12-01") });
    await tasks.update(open2.id, { recurrence: { unit: "MONTH" } });
    expect((await tasks.list({ status: "TODO" })).filter((x) => x.title === "Open one")).toHaveLength(1);
  });

  it("makes an existing task repeat", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-02") });
    const repeating = await tasks.update(t.id, { recurrence: { unit: "WEEK", every: 2 } });
    expect(repeating.recurrence).toMatchObject({ unit: "WEEK", every: 2, active: true });
    await expect(tasks.update((await tasks.create({ title: "No date" })).id, { recurrence: { unit: "WEEK" } })).rejects.toThrow(/needs a due date/);
  });
});

describe("what is shown", () => {
  it("'shown' leaves out later and skipped occurrences; the default leaves out skipped ones only", async () => {
    const { tasks } = setup();
    const now = { now: at("2026-11-01T09:00:00Z") };
    const t = await tasks.create({ title: "Kraan", dueDate: day("2026-11-01"), recurrence: yearly }, now);
    await tasks.complete(t.id, now);
    await tasks.create({ title: "Once" }, now);
    expect((await tasks.list({}, now)).map((x) => [x.title, x.status, x.later])).toEqual(
      expect.arrayContaining([["Kraan", "DONE", false], ["Kraan", "TODO", true], ["Once", "TODO", false]]),
    );
    expect((await tasks.list({ shown: true }, now)).map((x) => [x.title, x.status])).toEqual(
      expect.arrayContaining([["Kraan", "DONE"], ["Once", "TODO"]]),
    );
    expect(await tasks.list({ shown: true }, now)).toHaveLength(2);
    // Daily and weekly tasks without a lead are never "later".
    const weekly = await tasks.create({ title: "Bins", dueDate: day("2026-11-09"), recurrence: { unit: "WEEK" } }, now);
    expect(weekly.later).toBe(false);
  });

  it("today is the server's day", () => {
    expect(serverToday(at("2026-11-24T12:00:00Z"))).toMatch(/^2026-11-2[345]$/);
  });
});

describe("progress counts (#105)", () => {
  it("counts done tasks and open ones shown now; never skipped or 'later' occurrences", () => {
    const today = "2026-11-24";
    expect(
      progressCounts(
        [
          { status: "DONE" },
          { status: "TODO" },
          { status: "TODO", showFrom: day("2026-11-24") },
          { status: "TODO", showFrom: day("2027-10-11") }, // later
          { status: "ARCHIVED" }, // skipped
          { status: "DONE", showFrom: day("2027-10-11") },
        ],
        today,
      ),
    ).toEqual({ total: 4, done: 2, ratio: 0.5 });
    // A goal whose only task is a yearly one done this year is at 100%.
    expect(progressCounts([{ status: "DONE" }, { status: "TODO", showFrom: day("2027-10-11") }], today).ratio).toBe(1);
  });
});

describe("previews for the calendar (#105 step 2)", () => {
  const now = { now: at("2026-11-24T09:00:00Z"), ...brussels };

  it("works out the coming occurrences for the range; they are not tasks", async () => {
    const { repo, tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-23"), recurrence: { unit: "WEEK" } }, now);
    await tasks.create({ title: "Once", dueDate: day("2026-12-01") }, now);
    const previews = await tasks.previews("2026-11-30", "2026-12-13", now);
    expect(previews).toEqual([
      { seriesId: t.seriesId, taskId: t.id, title: "Bins", day: "2026-11-30", dueDate: "2026-11-30T00:00:00.000Z", scheduledTime: null, approximate: false },
      expect.objectContaining({ day: "2026-12-07" }),
    ]);
    // Nothing was written: two tasks, no new occurrence.
    expect(await repo.findMany()).toHaveLength(2);
  });

  it("follows a scheduled day and its time", async () => {
    const { tasks } = setup();
    // Saturday 21 November, for a task due Monday 23rd.
    await tasks.create(
      { title: "Shop", dueDate: day("2026-11-23"), scheduledDay: day("2026-11-21"), scheduledTime: "10:00", recurrence: { unit: "WEEK" } },
      now,
    );
    const [p] = await tasks.previews("2026-11-23", "2026-11-29", now);
    expect(p).toMatchObject({ day: "2026-11-28", dueDate: "2026-11-30T00:00:00.000Z", scheduledTime: "10:00" });
  });

  it("an ended series, a done open occurrence or a task that does not repeat shows none", async () => {
    const { tasks } = setup();
    const ended = await tasks.create({ title: "Stopped", dueDate: day("2026-11-23"), recurrence: { unit: "WEEK" } }, now);
    await tasks.update(ended.id, { recurrence: null }, now);
    await tasks.create({ title: "Once", dueDate: day("2026-11-30") }, now);
    expect(await tasks.previews("2026-11-30", "2026-12-06", now)).toEqual([]);
  });

  it("after completing, the previews move on: the new open occurrence is a task, the next one a preview", async () => {
    const { tasks } = setup();
    const t = await tasks.create({ title: "Bins", dueDate: day("2026-11-23"), recurrence: { unit: "WEEK" } }, now);
    await tasks.complete(t.id, now);
    const open = (await tasks.list({ status: "TODO" }, now))[0]!;
    expect(plain(open.dueDate)).toBe("2026-11-30");
    expect((await tasks.previews("2026-11-30", "2026-12-13", now)).map((p) => [p.day, p.taskId])).toEqual([["2026-12-07", open.id]]);
  });

  it("counted from completion: one approximate preview", async () => {
    const { tasks } = setup();
    await tasks.create({ title: "Haircut", dueDate: day("2026-11-26"), recurrence: { unit: "WEEK", every: 2, from: "COMPLETION" } }, now);
    expect(await tasks.previews("2026-11-30", "2027-01-24", now)).toEqual([
      expect.objectContaining({ day: "2026-12-10", approximate: true }),
    ]);
  });

  it("refuses a backwards or too long range", async () => {
    const { tasks } = setup();
    await expect(tasks.previews("2026-12-06", "2026-11-30")).rejects.toThrow(TaskRuleError);
    await expect(tasks.previews("2026-11-01", "2027-01-31")).rejects.toThrow(/at most/);
  });
});
