import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { HabitView } from "@clock-compass/web-client/api";
import { run, testQueryClient, tick } from "./test-client";

const api = vi.hoisted(() => ({
  toggleHabit: vi.fn(),
  getRenewalSummary: vi.fn(async () => []),
  listHabits: vi.fn(async (): Promise<HabitView[]> => []),
  getIntentions: vi.fn(async () => []),
  setIntention: vi.fn(async () => ({})),
  createHabit: vi.fn(),
  deleteHabit: vi.fn(async () => undefined),
  logRenewalActivity: vi.fn(async () => ({})),
  getRenewalTrends: vi.fn(),
  listRenewalActivities: vi.fn(async () => []),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const {
  addHabit,
  habitsQuery,
  intentionsQuery,
  logActivity,
  removeHabit,
  saveIntention,
  summaryQuery,
  toggleHabitToday,
} = await import("./renewal");

const habit = (overrides: Partial<HabitView> = {}): HabitView => ({
  id: "h1",
  name: "Morning stretch",
  dimension: "PHYSICAL",
  goalId: null,
  goalTitle: null,
  targetPerWeek: 7,
  markedToday: false,
  doneThisWeek: 2,
  weekDays: [],
  streak: 0,
  ...overrides,
});

/** A request that stays in flight until the test settles it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

let client: QueryClient;
const habits = () => client.getQueryData(habitsQuery.queryKey) ?? [];

beforeEach(async () => {
  vi.clearAllMocks();
  api.toggleHabit.mockReset();
  client = testQueryClient();
  api.listHabits.mockResolvedValueOnce([habit()]);
  await client.fetchQuery(habitsQuery);
  await client.fetchQuery(intentionsQuery);
});

// Ported case for case from stores/renewal.test.ts.
describe("habit check-in: two toggles that both fail", () => {
  it.each(["first-first", "second-first"] as const)(
    "ends unmarked with the week count unchanged (%s)",
    async (order) => {
      const a = deferred<HabitView>();
      const b = deferred<HabitView>();
      api.toggleHabit.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const first = run(client, toggleHabitToday, habits()[0]!);
      await tick();
      expect(habits()[0]).toMatchObject({ markedToday: true, doneThisWeek: 3 });
      const second = run(client, toggleHabitToday, habits()[0]!);
      await tick();
      expect(habits()[0]).toMatchObject({ markedToday: false, doneThisWeek: 2 });
      if (order === "first-first") {
        a.reject(new Error("offline"));
        await first;
        b.reject(new Error("offline"));
        await second;
      } else {
        b.reject(new Error("offline"));
        await second;
        a.reject(new Error("offline"));
        await first;
      }
      expect(habits()[0]).toMatchObject({ markedToday: false, doneThisWeek: 2 });
    },
  );

  it("a failed first toggle keeps the server's answer to the second", async () => {
    const a = deferred<HabitView>();
    api.toggleHabit
      .mockReturnValueOnce(a.promise)
      .mockResolvedValueOnce(habit({ markedToday: true, doneThisWeek: 3 }));
    const first = run(client, toggleHabitToday, habits()[0]!);
    await tick();
    await run(client, toggleHabitToday, habits()[0]!);
    a.reject(new Error("offline"));
    await first;
    // The server toggled once (from unmarked), so it is marked: that is what shows.
    expect(habits()[0]).toMatchObject({ markedToday: true, doneThisWeek: 3 });
  });
});

describe("renewal writes", () => {
  it("a check-in reloads the dimension summary", async () => {
    api.toggleHabit.mockResolvedValueOnce(habit({ markedToday: true, doneThisWeek: 3 }));
    api.getRenewalSummary.mockResolvedValueOnce([{ dimension: "PHYSICAL" } as never]);
    await run(client, toggleHabitToday, habits()[0]!);
    await tick();
    expect(client.getQueryData(summaryQuery.queryKey)).toEqual([{ dimension: "PHYSICAL" }]);
  });

  it.each(["first-first", "second-first"] as const)(
    "two intention edits that both fail end as before (%s)",
    async (order) => {
      client.setQueryData(intentionsQuery.queryKey, { PHYSICAL: "Walk daily" });
      const a = deferred<object>();
      const b = deferred<object>();
      api.setIntention.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const first = run(client, saveIntention, { dimension: "PHYSICAL", text: "Run twice" });
      const second = run(client, saveIntention, { dimension: "PHYSICAL", text: "  " }); // clears
      await tick();
      expect(client.getQueryData(intentionsQuery.queryKey)).toEqual({ PHYSICAL: undefined });
      if (order === "first-first") {
        a.reject(new Error("offline"));
        await first;
        b.reject(new Error("offline"));
        await second;
      } else {
        b.reject(new Error("offline"));
        await second;
        a.reject(new Error("offline"));
        await first;
      }
      expect(client.getQueryData(intentionsQuery.queryKey)).toEqual({ PHYSICAL: "Walk daily" });
      expect(api.setIntention).toHaveBeenCalledWith("PHYSICAL", "");
    },
  );

  it("adds a habit once the server has created it, then reloads the summary", async () => {
    api.createHabit.mockResolvedValueOnce(habit({ id: "h2", name: "Read" }));
    await run(client, addHabit, { name: "Read", dimension: "MENTAL" });
    expect(habits().map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(toastMock.success).toHaveBeenCalledWith("Habit added");
    expect(api.getRenewalSummary).toHaveBeenCalled();
  });

  it("a failed add changes nothing", async () => {
    api.createHabit.mockRejectedValueOnce(new Error("Name taken"));
    await run(client, addHabit, { name: "Read" });
    expect(habits().map((h) => h.id)).toEqual(["h1"]);
    expect(toastMock.error).toHaveBeenCalledWith("Name taken");
  });

  it("a failed delete during a check-in puts back the server's version", async () => {
    const toggle = deferred<HabitView>();
    const del = deferred<undefined>();
    api.toggleHabit.mockReturnValueOnce(toggle.promise);
    api.deleteHabit.mockReturnValueOnce(del.promise);
    const toggling = run(client, toggleHabitToday, habits()[0]!);
    await tick();
    const deleting = run(client, removeHabit, habits()[0]!); // carries the unconfirmed check-in
    await tick();
    expect(habits()).toEqual([]);
    toggle.reject(new Error("offline"));
    await toggling;
    del.reject(new Error("offline"));
    await deleting;
    expect(habits()[0]).toMatchObject({ markedToday: false, doneThisWeek: 2 });
  });

  it("logging a one-off reloads the summary", async () => {
    await run(client, logActivity, { dimension: "SPIRITUAL", title: "Retreat" });
    expect(api.logRenewalActivity).toHaveBeenCalledWith({ dimension: "SPIRITUAL", title: "Retreat" });
    expect(toastMock.success).toHaveBeenCalledWith("Renewal logged");
    expect(api.getRenewalSummary).toHaveBeenCalled();
  });
});
