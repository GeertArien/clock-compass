import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { Goal } from "@clock-compass/web-client/api";
import { run, testQueryClient, tick } from "./test-client";

const api = vi.hoisted(() => ({
  listGoals: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  deleteGoal: vi.fn(async () => undefined),
  reorderGoals: vi.fn(async () => undefined),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const { addGoal, editGoal, goalsQuery, refreshGoals, removeGoal, reorderGoal, statusEdit } =
  await import("./goals");

const goal = (id: string, roleId: string | null = null, title = id): Goal => ({
  id,
  title,
  description: null,
  targetDate: null,
  status: "ACTIVE",
  order: 0,
  roleId,
  dimension: null,
  progress: { total: 0, done: 0, ratio: 0 },
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
});

/** A request that stays in flight until the test settles it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

let client: QueryClient;
const goals = () => client.getQueryData(goalsQuery.queryKey) ?? [];
const ids = () => goals().map((g) => g.id);

describe("goals query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listGoals.mockReset();
    api.updateGoal.mockReset();
    client = testQueryClient();
    // Two role groups interleaved in the flat list: p (parent) and w (work).
    client.setQueryData(goalsQuery.queryKey, [
      goal("p1", "parent"),
      goal("w1", "work"),
      goal("p2", "parent"),
      goal("w2", "work"),
    ]);
  });

  it("adds with a placeholder first, replaced by the created goal", async () => {
    const request = deferred<Goal>();
    api.createGoal.mockReturnValueOnce(request.promise);
    const pending = run(client, addGoal, { title: "Run a 10k" });
    await tick();
    expect(goals()[0]).toMatchObject({ title: "Run a 10k", status: "ACTIVE" });
    expect(goals()[0]!.id).toMatch(/^temp_/);
    request.resolve(goal("g9", null, "Run a 10k"));
    await pending;
    expect(ids()).toEqual(["g9", "p1", "w1", "p2", "w2"]);
    expect(toastMock.success).toHaveBeenCalledWith("Goal added");
  });

  it("a failed add drops its placeholder", async () => {
    api.createGoal.mockRejectedValueOnce(new Error("offline"));
    await run(client, addGoal, { title: "Run a 10k" });
    expect(ids()).toEqual(["p1", "w1", "p2", "w2"]);
    expect(toastMock.error).toHaveBeenCalledWith("offline");
  });

  it.each(["first-first", "second-first"] as const)(
    "a status change and a rename, both failing (%s), end as before",
    async (order) => {
      const a = deferred<Goal>();
      const b = deferred<Goal>();
      api.updateGoal.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const first = run(client, editGoal, statusEdit(goals()[0]!, "ON_HOLD"));
      await tick();
      const second = run(client, editGoal, { goal: goals()[0]!, body: { title: "Coach" } });
      await tick();
      expect(goals()[0]).toMatchObject({ status: "ON_HOLD", title: "Coach" });
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
      expect(goals()[0]).toMatchObject({ status: "ACTIVE", title: "p1" });
    },
  );

  it("a failed edit keeps a later edit's success", async () => {
    const a = deferred<Goal>();
    api.updateGoal
      .mockReturnValueOnce(a.promise)
      .mockResolvedValueOnce({ ...goal("p1", "parent"), title: "Coach" });
    const first = run(client, editGoal, statusEdit(goals()[0]!, "ON_HOLD"));
    await tick();
    await run(client, editGoal, { goal: goals()[0]!, body: { title: "Coach" } });
    a.reject(new Error("500"));
    await first;
    expect(goals()[0]).toMatchObject({ status: "ACTIVE", title: "Coach" });
  });

  it("a failed delete puts the goal back in place, without an edit that failed meanwhile", async () => {
    const edit = deferred<Goal>();
    const del = deferred<undefined>();
    api.updateGoal.mockReturnValueOnce(edit.promise);
    api.deleteGoal.mockReturnValueOnce(del.promise);
    const editing = run(client, editGoal, statusEdit(goals()[2]!, "ACHIEVED"));
    await tick();
    const deleting = run(client, removeGoal, goals()[2]!); // carries the unconfirmed ACHIEVED
    await tick();
    expect(ids()).toEqual(["p1", "w1", "w2"]);
    edit.reject(new Error("offline"));
    await editing;
    del.reject(new Error("offline"));
    await deleting;
    expect(ids()).toEqual(["p1", "w1", "p2", "w2"]);
    expect(goals()[2]).toMatchObject({ id: "p2", status: "ACTIVE" });
  });

  it("reorders one role group, keeping the other group's slots", async () => {
    const request = deferred<undefined>();
    api.reorderGoals.mockReturnValueOnce(request.promise);
    const pending = run(client, reorderGoal, ["p2", "p1"]);
    await tick();
    expect(ids()).toEqual(["p2", "w1", "p1", "w2"]);
    expect(goals().filter((g) => g.roleId === "parent").map((g) => g.order)).toEqual([0, 1]);
    request.resolve(undefined);
    await pending;
    expect(api.reorderGoals).toHaveBeenCalledWith(["p2", "p1"]);
  });

  it("a stale reorder (an unknown goal) changes nothing and sends nothing", async () => {
    await run(client, reorderGoal, ["p2", "gone"]);
    expect(ids()).toEqual(["p1", "w1", "p2", "w2"]);
    expect(api.reorderGoals).not.toHaveBeenCalled();
  });

  it("a failed reorder reloads the server's order quietly", async () => {
    api.reorderGoals.mockRejectedValueOnce(new Error("nope"));
    api.listGoals.mockResolvedValueOnce([goal("p1", "parent"), goal("w1", "work"), goal("p2", "parent")]);
    await run(client, reorderGoal, ["p2", "p1"]);
    expect(ids()).toEqual(["p1", "w1", "p2"]);
    expect(toastMock.error).toHaveBeenCalledWith("nope");
  });

  it("a silent refresh that fails keeps what's shown, with no error", async () => {
    api.listGoals.mockRejectedValueOnce(new Error("offline"));
    await refreshGoals(client);
    expect(ids()).toEqual(["p1", "w1", "p2", "w2"]);
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(client.getQueryState(goalsQuery.queryKey)?.status).toBe("success");
  });

  it("a refresh during an edit drops the bookkeeping; a late failure then changes nothing", async () => {
    const edit = deferred<Goal>();
    api.updateGoal.mockReturnValueOnce(edit.promise);
    const editing = run(client, editGoal, statusEdit(goals()[0]!, "ACHIEVED"));
    await tick();
    api.listGoals.mockResolvedValueOnce([{ ...goal("p1", "parent"), title: "Server" }]);
    await refreshGoals(client);
    edit.reject(new Error("offline"));
    await editing;
    expect(goals()[0]).toMatchObject({ title: "Server", status: "ACTIVE" });
  });
});
