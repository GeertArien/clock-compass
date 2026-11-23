import { beforeEach, describe, expect, it } from "vitest";
import { FakeHabitRepository } from "./fake-habit-repository.js";
import { RenewalService } from "./renewal-service.js";

// 2026-06-10 is a Wednesday (ISO week Mon Jun 8 – Sun Jun 14).
const now = new Date("2026-06-10T12:00:00");

describe("RenewalService", () => {
  let repo: FakeHabitRepository;
  let service: RenewalService;

  beforeEach(() => {
    repo = new FakeHabitRepository();
    service = new RenewalService(repo);
  });

  it("toggles a mark on and off, and rejects future days", async () => {
    const habit = await service.createHabit({ name: "Morning run", targetPerWeek: 4 });
    const marked = await service.toggleMark(habit.id, now, now);
    expect(marked.markedToday).toBe(true);
    expect(marked.doneThisWeek).toBe(1);

    const unmarked = await service.toggleMark(habit.id, now, now);
    expect(unmarked.markedToday).toBe(false);

    await expect(
      service.toggleMark(habit.id, new Date("2026-06-12T00:00:00"), now),
    ).rejects.toThrow(/future/i);
  });

  it("counts BOTH habit marks and one-off activities toward a dimension", async () => {
    const habit = await service.createHabit({
      name: "Run",
      dimension: "PHYSICAL",
      targetPerWeek: 3,
    });
    await service.toggleMark(habit.id, new Date("2026-06-09T00:00:00"), now);
    await service.logActivity({
      dimension: "PHYSICAL",
      title: "Long hike",
      occurredAt: new Date("2026-06-08T10:00:00"),
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
      const day = new Date("2026-06-10T00:00:00");
      day.setDate(day.getDate() - i);
      await service.toggleMark(habit.id, day, now);
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
    const nextWeek = new Date("2026-06-17T12:00:00");
    expect(await service.intentions(nextWeek)).toEqual([]);
    expect(repo.intentions).toHaveLength(1);

    // Empty text clears this week's intention.
    await service.setIntention("PHYSICAL", "  ", now);
    expect(await service.intentions(now)).toEqual([]);
  });

  it("compares this week to last across habits and one-offs", async () => {
    const habit = await service.createHabit({ name: "Pages", targetPerWeek: 3 });
    await service.toggleMark(habit.id, new Date("2026-06-09T00:00:00"), now); // this week
    await service.toggleMark(habit.id, new Date("2026-06-03T00:00:00"), now); // last week
    await service.logActivity({
      dimension: "SPIRITUAL",
      title: "Retreat",
      occurredAt: new Date("2026-06-06T09:00:00"), // last week
    });
    const trends = await service.trends(now);
    expect(trends.thisWeek).toBe(1);
    expect(trends.lastWeek).toBe(2);
    expect(trends.heatmap).toHaveLength(12);
    expect(trends.heatmap[11]).toHaveLength(7);
  });
});
