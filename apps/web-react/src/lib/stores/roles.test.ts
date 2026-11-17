import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@clock-compass/web-client/api";

const api = vi.hoisted(() => ({
  listRoles: vi.fn(async (): Promise<Role[]> => []),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(async () => undefined),
  reorderRoles: vi.fn(async () => undefined),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("./toast", () => ({ toast: toastMock }));

const { rolesStore } = await import("./roles");

const role = (id: string, order: number, name = id): Role => ({
  id,
  name,
  mission: null,
  order,
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z",
});

describe("rolesStore", () => {
  beforeEach(() => {
    toastMock.error.mockClear();
    rolesStore.setRoles([role("a", 0), role("b", 1)]);
  });

  it("a failed rename keeps a later edit to the same role", async () => {
    let fail!: (err: Error) => void;
    api.updateRole.mockImplementationOnce(() => new Promise((_r, reject) => (fail = reject)));
    const first = rolesStore.update(rolesStore.state.roles[0]!, { name: "Parent" });
    api.updateRole.mockImplementationOnce(async (id: string) => ({
      ...role(id, 0),
      mission: "Present, not just around.",
    }));
    await rolesStore.update(rolesStore.state.roles[0]!, { mission: "Present, not just around." });
    fail(new Error("500"));
    await first;
    expect(rolesStore.state.roles[0]).toMatchObject({ name: "a", mission: "Present, not just around." });
    expect(toastMock.error).toHaveBeenCalledWith("500");
  });

  it("reorders optimistically and reloads the server's order when it fails", async () => {
    api.reorderRoles.mockRejectedValueOnce(new Error("nope"));
    api.listRoles.mockResolvedValueOnce([role("a", 0), role("b", 1), role("c", 2)]);
    const pending = rolesStore.reorder(["b", "a"]);
    expect(rolesStore.state.roles.map((r) => r.id)).toEqual(["b", "a"]);
    await pending;
    expect(rolesStore.state.roles.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(toastMock.error).toHaveBeenCalledWith("nope");
  });

  it("a failed delete puts the role back in place", async () => {
    api.deleteRole.mockRejectedValueOnce(new Error("in use"));
    await rolesStore.remove(rolesStore.state.roles[0]!);
    expect(rolesStore.state.roles.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
