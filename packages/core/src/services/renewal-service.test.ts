import { beforeEach, describe, expect, it } from "vitest";
import { FakeHabitRepository } from "./fake-habit-repository.js";
import { RenewalService } from "./renewal-service.js";
import { addDays } from "../domain/week.js";

// 2026-06-10 is a Wednesday (ISO week Mon Jun 8 – Sun Jun 14). Read in UTC.
const now = { now: new Date("2026-06-10T12:00:00Z"), timeZone: "UTC" };

describe("RenewalService", () => {
  let repo: FakeHabitRepository;
  let service: RenewalService;

  beforeEach(() => {
    repo = new FakeHabitRepository();
    service = new RenewalService(repo);
  });

  it("toggles a mark on and off, and rejects future days", async () => {
    const habit = await service.createHabit({ name: "Morning run", targetPerWeek: 4 });
    const marked = await service.toggleMark(habit.id, undefined, now);
    expect(marked.markedToday).toBe(true);
    expect(marked.doneThisWeek).toBe(1);

    const unmarked = await service.toggleMark(habit.id, "2026-06-10", now);
    expect(unmarked.markedToday).toBe(false);

    await expect(
      service.toggleMark(habit.id, "2026-06-12", now),
    ).rejects.toThrow(/future/i);
    await expect(service.toggleMark(habit.id, "2026-06-31", now)).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("counts BOTH habit marks and one-off activities toward a dimension", async () => {
    const habit = await service.createHabit({
      name: "Run",
      dimension: "PHYSICAL",
      targetPerWeek: 3,
    });
    await service.toggleMark(habit.id, "2026-06-09", now);
    await service.logActivity({
      dimension: "PHYSICAL",
      title: "Long hike",
      occurredAt: new Date("2026-06-08T10:00:00Z"),
    });

    const summary = await service.summary(now);
    const physical = summary.find((s) => s.dimension === "PHYSICAL")!;
    expect(physical.habitsDone).toBe(1);
    expect(physical.habitsTarget).toBe(3);
    expect(physical.oneOffs).toBe(1);
    expect(physical.total).toBe(2);
  });

  it("derives goal momentum from linked habits over 30 days", async () => {
    const habit = await service.createHabit({
      name: "Spanish lesson",
      goalId: "goal_es",
      targetPerWeek: 7,
    });
    // 15 marks in the last 30 days against a possible 30.
    for (let i = 0; i < 15; i++) {
      await service.toggleMark(habit.id, addDays("2026-06-10", -i), now);
    }
    const trends = await service.trends(now);
    expect(trends.goalMomentum).toHaveLength(1);
    expect(trends.goalMomentum[0]!.pct).toBe(50);
    expect(trends.longestStreak.habitName).toBe("Spanish lesson");
  });

  it("scopes weekly intentions to the ISO week and keeps history", async () => {
    await service.setIntention("PHYSICAL", "Keep the long run, even if it rains.", now);
    expect(await service.intentions(now)).toEqual([
      { dimension: "PHYSICAL", text: "Keep the long run, even if it rains." },
    ]);

    // Next week starts blank, but last week's row is retained (history kept).
    const nextWeek = { now: new Date("2026-06-17T12:00:00Z"), timeZone: "UTC" };
    expect(await service.intentions(nextWeek)).toEqual([]);
    expect(repo.intentions).toHaveLength(1);

    // Empty text clears this week's intention.
    await service.setIntention("PHYSICAL", "  ", now);
    expect(await service.intentions(now)).toEqual([]);
  });

  it("compares this week to last across habits and one-offs", async () => {
    const habit = await service.createHabit({ name: "Pages", targetPerWeek: 3 });
    await service.toggleMark(habit.id, "2026-06-09", now); // this week
    await service.toggleMark(habit.id, "2026-06-03", now); // last week
    await service.logActivity({
      dimension: "SPIRITUAL",
      title: "Retreat",
      occurredAt: new Date("2026-06-06T09:00:00Z"), // last week
    });
    const trends = await service.trends(now);
    expect(trends.thisWeek).toBe(1);
    expect(trends.lastWeek).toBe(2);
    expect(trends.heatmap).toHaveLength(12);
    expect(trends.heatmap[11]).toHaveLength(7);
  });
});

describe("RenewalService.setMark: the same target state twice at once (#109 step 3 review)", () => {
  const now = { now: new Date("2026-11-24T10:00:00Z"), timeZone: "UTC" };
  /** A repository where another call wins the race: the write finds the row already there, or already gone. */
  class RacingRepository extends FakeHabitRepository {
    override async createMark(habitId: string, day: Date): Promise<void> {
      await super.createMark(habitId, day);
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    }
    override async deleteMark(id: string): Promise<void> {
      await super.deleteMark(id);
      throw Object.assign(new Error("Record to delete does not exist"), { code: "P2025" });
    }
  }

  it("answers 'nothing changed' when the other call made or removed the mark first", async () => {
    const service = new RenewalService(new RacingRepository());
    const habit = await service.createHabit({ name: "Morning run" });
    expect((await service.setMark(habit.id, undefined, true, now)).changed).toBe(false);
    expect((await service.listHabits(now))[0]?.markedToday).toBe(true);
    expect((await service.setMark(habit.id, undefined, false, now)).changed).toBe(false);
    expect((await service.listHabits(now))[0]?.markedToday).toBe(false);
  });

  it("still throws any other error", async () => {
    class Broken extends FakeHabitRepository {
      override async createMark(): Promise<void> {
        throw new Error("disk full");
      }
    }
    const service = new RenewalService(new Broken());
    const habit = await service.createHabit({ name: "Morning run" });
    await expect(service.setMark(habit.id, undefined, true, now)).rejects.toThrow("disk full");
  });
});

describe("RenewalService: today is the caller's day, stored as a plain date (#112)", () => {
  const BRUSSELS = "Europe/Brussels";
  const NEW_YORK = "America/New_York";
  let repo: FakeHabitRepository;
  let service: RenewalService;

  beforeEach(() => {
    repo = new FakeHabitRepository();
    service = new RenewalService(repo);
  });

  it("puts a check-off at 00:30 in Brussels on the Brussels day, stored at UTC midnight", async () => {
    const habit = await service.createHabit({ name: "Stretch" });
    // Tue 24 Nov 2026 00:30 in Brussels is still Mon 23 Nov in UTC.
    const clock = { now: new Date("2026-11-23T23:30:00Z"), timeZone: BRUSSELS };
    const view = await service.toggleMark(habit.id, undefined, clock);
    expect(repo.marks.map((m) => m.day.toISOString())).toEqual(["2026-11-24T00:00:00.000Z"]);
    expect(view.markedToday).toBe(true);
    expect(view.weekDays).toEqual([false, true, false, false, false, false, false]);
  });

  it("counts Monday 00:30 in Brussels for the new week", async () => {
    const habit = await service.createHabit({ name: "Stretch", targetPerWeek: 1 });
    // Mon 30 Nov 00:30 in Brussels = Sun 29 Nov 23:30 UTC.
    const clock = { now: new Date("2026-11-29T23:30:00Z"), timeZone: BRUSSELS };
    const view = await service.toggleMark(habit.id, undefined, clock);
    expect(view.weekDays[0]).toBe(true);
    expect(view.doneThisWeek).toBe(1);
    expect(view.streak).toBe(1);
  });

  it("keeps a late-evening check-off in New York (west of UTC) on the New York day and week", async () => {
    const habit = await service.createHabit({ name: "Read" });
    // Sun 29 Nov 2026 23:00 in New York = Mon 30 Nov 04:00 UTC.
    const clock = { now: new Date("2026-11-30T04:00:00Z"), timeZone: NEW_YORK };
    const view = await service.toggleMark(habit.id, undefined, clock);
    expect(repo.marks[0]!.day.toISOString()).toBe("2026-11-29T00:00:00.000Z");
    expect(view.weekDays[6]).toBe(true); // Sunday of the week of 23 Nov
    expect(view.markedToday).toBe(true);
  });

  it("follows the caller's zone when it differs from the server's", async () => {
    // The device is in New York at 23:00 on the 24th; the server may run in
    // Brussels, where it is already the 25th. The mark is on the device's day.
    const habit = await service.createHabit({ name: "Journal" });
    const now = new Date("2026-11-25T04:00:00Z");
    const view = await service.toggleMark(habit.id, undefined, { now, timeZone: NEW_YORK });
    expect(repo.marks[0]!.day.toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(view.markedToday).toBe(true);
    // Read back by the same device: still today. By Brussels: yesterday.
    expect((await service.listHabits({ now, timeZone: NEW_YORK }))[0]!.markedToday).toBe(true);
    expect((await service.listHabits({ now, timeZone: BRUSSELS }))[0]!.markedToday).toBe(false);
  });

  it("keeps days right around both clock changes of 2026", async () => {
    const habit = await service.createHabit({ name: "Walk" });
    // Sun 29 March 2026, 00:30 and 23:30 in Brussels (the spring change at 02:00).
    await service.setMark(habit.id, undefined, true, { now: new Date("2026-03-28T23:30:00Z"), timeZone: BRUSSELS });
    // Sun 25 October 2026, 23:30 in Brussels (after the autumn change).
    await service.setMark(habit.id, undefined, true, { now: new Date("2026-10-25T22:30:00Z"), timeZone: BRUSSELS });
    expect(repo.marks.map((m) => m.day.toISOString().slice(0, 10)).sort()).toEqual(["2026-03-29", "2026-10-25"]);
  });

  it("finds this week's intention right after midnight on Monday", async () => {
    // Set on Sunday evening for the week of 23 Nov; read at Mon 30 Nov 00:05 in Brussels.
    await service.setIntention("MENTAL", "One chapter a day", { now: new Date("2026-11-29T20:00:00Z"), timeZone: BRUSSELS });
    expect(repo.intentions[0]!.weekStart.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    const monday = { now: new Date("2026-11-29T23:05:00Z"), timeZone: BRUSSELS };
    expect(await service.intentions(monday)).toEqual([]);
    await service.setIntention("MENTAL", "Finish the book", monday);
    expect(repo.intentions[1]!.weekStart.toISOString()).toBe("2026-11-30T00:00:00.000Z");
    expect(await service.intentions(monday)).toEqual([{ dimension: "MENTAL", text: "Finish the book" }]);
  });

  it("counts a one-off activity on the day it happened in the caller's zone", async () => {
    // Mon 30 Nov 00:30 in Brussels: this week for Brussels, last week in UTC.
    await service.logActivity({ dimension: "PHYSICAL", title: "Swim", occurredAt: new Date("2026-11-29T23:30:00Z") });
    const clock = { now: new Date("2026-11-30T10:00:00Z"), timeZone: BRUSSELS };
    const physical = (await service.summary(clock)).find((d) => d.dimension === "PHYSICAL")!;
    expect(physical.oneOffs).toBe(1);
    const trends = await service.trends(clock);
    expect(trends.thisWeek).toBe(1);
    expect(trends.heatmap[11]![0]).toBe(1); // Monday of this week
  });
});
