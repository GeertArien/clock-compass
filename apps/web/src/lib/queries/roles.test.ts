import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { Role } from "@clock-compass/web-client/api";
import { observe, run, settled, testQueryClient, tick } from "./test-client";

const api = vi.hoisted(() => ({
  listRoles: vi.fn(async (): Promise<Role[]> => []),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(async () => undefined),
  reorderRoles: vi.fn(async () => undefined),
  listGoals: vi.fn(async () => []),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const { addRole, editRole, removeRole, reorderRole, rolesQuery } = await import("./roles");

const role = (id: string, order: number, name = id): Role => ({
  id,
  name,
  mission: null,
  order,
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
const roles = () => client.getQueryData(rolesQuery.queryKey) ?? [];

describe("roles query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client = testQueryClient();
    client.setQueryData(rolesQuery.queryKey, [role("a", 0), role("b", 1)]);
  });

  it("a failed rename keeps a later edit to the same role", async () => {
    let fail!: (err: Error) => void;
    api.updateRole.mockImplementationOnce(() => new Promise((_r, reject) => (fail = reject)));
    const first = run(client, editRole, { role: roles()[0]!, body: { name: "Parent" } });
    await tick();
    api.updateRole.mockImplementationOnce(async (id: string) => ({
      ...role(id, 0),
      mission: "Present, not just around.",
    }));
    await run(client, editRole, { role: roles()[0]!, body: { mission: "Present, not just around." } });
    fail(new Error("500"));
    await first;
    expect(roles()[0]).toMatchObject({ name: "a", mission: "Present, not just around." });
    expect(toastMock.error).toHaveBeenCalledWith("500");
  });

  it("reorders optimistically and reloads the server's order when it fails", async () => {
    const { unsubscribe } = observe(client, rolesQuery); // the panel showing the roles
    const request = deferred<undefined>();
    api.reorderRoles.mockReturnValueOnce(request.promise);
    api.listRoles.mockResolvedValueOnce([role("a", 0), role("b", 1), role("c", 2)]);
    const pending = run(client, reorderRole, ["b", "a"]);
    await tick();
    expect(roles().map((r) => r.id)).toEqual(["b", "a"]);
    request.reject(new Error("nope"));
    await pending;
    await settled(observe(client, rolesQuery).observer);
    expect(roles().map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(toastMock.error).toHaveBeenCalledWith("nope");
    unsubscribe();
  });

  it("a stale reorder (not every role) changes nothing and sends nothing", async () => {
    await run(client, reorderRole, ["b"]);
    expect(roles().map((r) => r.id)).toEqual(["a", "b"]);
    expect(api.reorderRoles).not.toHaveBeenCalled();
  });

  it("a failed delete puts the role back in place", async () => {
    const request = deferred<undefined>();
    api.deleteRole.mockReturnValueOnce(request.promise);
    const pending = run(client, removeRole, roles()[0]!);
    await tick();
    expect(roles().map((r) => r.id)).toEqual(["b"]);
    request.reject(new Error("in use"));
    await pending;
    expect(roles().map((r) => r.id)).toEqual(["a", "b"]);
    expect(toastMock.error).toHaveBeenCalledWith("in use");
  });

  it("deleting a role reloads the goals, success or failure, without the screen", async () => {
    // No component involved: the reload must not depend on GoalsPanel being mounted.
    await run(client, removeRole, roles()[0]!);
    expect(api.listGoals).toHaveBeenCalledTimes(1);
    api.deleteRole.mockRejectedValueOnce(new Error("in use"));
    await run(client, removeRole, roles()[0]!);
    expect(api.listGoals).toHaveBeenCalledTimes(2);
  });

  it("adds with a placeholder, replaced by the created role", async () => {
    const request = deferred<Role>();
    api.createRole.mockReturnValueOnce(request.promise);
    const pending = run(client, addRole, { name: "Coach" });
    await tick();
    expect(roles()[2]).toMatchObject({ name: "Coach" });
    expect(roles()[2]!.id).toMatch(/^temp_/);
    request.resolve(role("c", 2, "Coach"));
    await pending;
    expect(roles().map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(toastMock.success).toHaveBeenCalledWith("Role added");
  });

  it("a failed add drops its placeholder", async () => {
    api.createRole.mockRejectedValueOnce(new Error("offline"));
    await run(client, addRole, { name: "Coach" });
    expect(roles().map((r) => r.id)).toEqual(["a", "b"]);
    expect(toastMock.error).toHaveBeenCalledWith("offline");
  });

  it("a reload drops the in-flight bookkeeping; a late failure then changes nothing", async () => {
    let fail!: (err: Error) => void;
    api.updateRole.mockImplementationOnce(() => new Promise((_r, reject) => (fail = reject)));
    const pending = run(client, editRole, { role: roles()[0]!, body: { name: "Parent" } });
    await tick();
    api.listRoles.mockResolvedValueOnce([role("a", 0, "Server"), role("b", 1)]);
    await client.fetchQuery({ ...rolesQuery, staleTime: 0 });
    fail(new Error("offline"));
    await pending;
    expect(roles()[0]).toMatchObject({ name: "Server" });
  });
});

describe("roles query: a failed delete during a rename", () => {
  it.each([
    ["rename fails, then delete fails", "fail", "before", "a"],
    ["delete fails, then rename fails", "fail", "after", "a"],
    ["rename succeeds, then delete fails", "ok", "before", "Parent"],
    ["delete fails, then rename succeeds", "ok", "after", "Parent"],
  ] as const)("%s", async (_name, renameOutcome, renameSettles, expected) => {
    client = testQueryClient();
    client.setQueryData(rolesQuery.queryKey, [role("a", 0), role("b", 1)]);
    const rename = deferred<Role>();
    const remove = deferred<undefined>();
    api.updateRole.mockReturnValueOnce(rename.promise);
    api.deleteRole.mockReturnValueOnce(remove.promise);
    const renaming = run(client, editRole, { role: roles()[0]!, body: { name: "Parent" } });
    await tick();
    const deleting = run(client, removeRole, roles()[0]!); // carries the unconfirmed "Parent"
    await tick();
    const settleRename = async () => {
      if (renameOutcome === "ok") rename.resolve(role("a", 0, "Parent"));
      else rename.reject(new Error("offline"));
      await renaming;
    };
    if (renameSettles === "before") await settleRename();
    remove.reject(new Error("offline"));
    await deleting;
    if (renameSettles === "after") await settleRename();
    expect(roles().map((r) => r.name)).toEqual([expected, "b"]);
  });
});

describe("roles query: two overlapping edits that both fail", () => {
  it.each(["first-first", "second-first"] as const)(
    "a rename then a mission edit, both failing (%s), ends as before",
    async (order) => {
      client = testQueryClient();
      client.setQueryData(rolesQuery.queryKey, [role("a", 0), role("b", 1)]);
      const rejects: ((err: Error) => void)[] = [];
      const deferred = () => new Promise<never>((_r, reject) => rejects.push(reject));
      api.updateRole.mockImplementationOnce(deferred).mockImplementationOnce(deferred);
      const first = run(client, editRole, { role: roles()[0]!, body: { name: "Parent" } });
      await tick();
      const second = run(client, editRole, { role: roles()[0]!, body: { name: "Coach" } });
      await tick();
      expect(roles()[0]).toMatchObject({ name: "Coach" });
      const [ra, rb] = rejects as [(e: Error) => void, (e: Error) => void];
      if (order === "first-first") {
        ra(new Error("offline"));
        await first;
        rb(new Error("offline"));
        await second;
      } else {
        rb(new Error("offline"));
        await second;
        ra(new Error("offline"));
        await first;
      }
      expect(roles()[0]).toMatchObject({ name: "a" });
    },
  );
});
