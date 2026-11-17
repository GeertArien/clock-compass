import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HabitView } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  toggleHabit: vi.fn(),
  getRenewalSummary: vi.fn(async () => []),
  listHabits: vi.fn(async () => []),
  getIntentions: vi.fn(async () => []),
}));
vi.mock("@/lib/components/ui/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const api = await import("@/lib/api");
const { renewalStore } = await import("./renewal.svelte");

const habit = (overrides: Partial<HabitView> = {}): HabitView => ({
  id: "h1",
  name: "Morning stretch",
  dimension: "PHYSICAL",
  goalId: null,
  goalTitle: null,
  targetPerWeek: 7,
  weekDays: [],
  markedToday: false,
  doneThisWeek: 2,
  streak: 0,
  ...overrides,
});

describe("renewalStore: two check-in toggles that both fail", () => {
  beforeEach(async () => {
    vi.mocked(api.listHabits).mockResolvedValueOnce([habit()]);
    await renewalStore.load();
  });

  it.each(["first-first", "second-first"] as const)(
    "ends unmarked with the week count unchanged (%s)",
    async (order) => {
      const rejects: ((err: Error) => void)[] = [];
      const deferred = () => new Promise<never>((_r, reject) => rejects.push(reject));
      vi.mocked(api.toggleHabit).mockImplementationOnce(deferred).mockImplementationOnce(deferred);
      const a = renewalStore.toggleToday(renewalStore.habits[0]!);
      expect(renewalStore.habits[0]).toMatchObject({ markedToday: true, doneThisWeek: 3 });
      const b = renewalStore.toggleToday(renewalStore.habits[0]!);
      expect(renewalStore.habits[0]).toMatchObject({ markedToday: false, doneThisWeek: 2 });
      const [ra, rb] = rejects as [(e: Error) => void, (e: Error) => void];
      if (order === "first-first") {
        ra(new Error("offline"));
        await a;
        rb(new Error("offline"));
        await b;
      } else {
        rb(new Error("offline"));
        await b;
        ra(new Error("offline"));
        await a;
      }
      expect(renewalStore.habits[0]).toMatchObject({ markedToday: false, doneThisWeek: 2 });
    },
  );

  it("a failed first toggle keeps the server's answer to the second", async () => {
    const rejects: ((err: Error) => void)[] = [];
    vi.mocked(api.toggleHabit)
      .mockImplementationOnce(() => new Promise<never>((_r, reject) => rejects.push(reject)))
      .mockImplementationOnce(async () => habit({ markedToday: true, doneThisWeek: 3 }));
    const a = renewalStore.toggleToday(renewalStore.habits[0]!);
    await renewalStore.toggleToday(renewalStore.habits[0]!);
    rejects[0]!(new Error("offline"));
    await a;
    // The server toggled once (from unmarked), so it is marked: that is what shows.
    expect(renewalStore.habits[0]).toMatchObject({ markedToday: true, doneThisWeek: 3 });
  });
});
