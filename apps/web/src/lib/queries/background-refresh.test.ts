import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  focusManager,
  onlineManager,
  QueryObserver,
  type QueryClient,
} from "@tanstack/react-query";
import type { Role } from "@clock-compass/web-client/api";
import { BACKGROUND_REFRESH_AFTER_MS, createQueryClient } from "@/lib/query-client";
import { loadError } from "./load-error";
import { run, tick } from "./test-client";

const api = vi.hoisted(() => ({
  listRoles: vi.fn(),
  updateRole: vi.fn(),
  listGoals: vi.fn(async () => []),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const { editRole, rolesQuery } = await import("./roles");

const role = (id: string, name = id): Role => ({
  id,
  name,
  mission: null,
  order: 0,
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
let observer: QueryObserver<Role[], Error, Role[], Role[], readonly ["roles"]>;
let unsubscribe: () => void;
const roles = () => client.getQueryData(rolesQuery.queryKey) ?? [];
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

/** Coming back to the tab (what the browser's visibilitychange does). */
async function refocus() {
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await settle();
}

describe("background refresh on focus and reconnect", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    api.listRoles.mockReset();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-18T12:00:00Z") });
    client = createQueryClient();
    client.mount(); // what QueryClientProvider does: listen to focus and online
    api.listRoles.mockResolvedValueOnce([role("a", "Parent")]);
    observer = new QueryObserver(client, rolesQuery); // a screen showing the roles
    unsubscribe = observer.subscribe(() => {});
    await settle();
  });
  afterEach(() => {
    unsubscribe();
    client.unmount();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  const age = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it("refetches shown data older than the threshold when the tab comes back", async () => {
    age(BACKGROUND_REFRESH_AFTER_MS + 1);
    api.listRoles.mockResolvedValueOnce([role("a", "Parent"), role("b", "Coach")]);
    await refocus();
    expect(api.listRoles).toHaveBeenCalledTimes(2);
    expect(roles().map((r) => r.name)).toEqual(["Parent", "Coach"]);
  });

  it("a quick tab switch refetches nothing", async () => {
    age(BACKGROUND_REFRESH_AFTER_MS - 1000);
    await refocus();
    expect(api.listRoles).toHaveBeenCalledTimes(1);
  });

  it("navigating to a screen (a new observer) refetches nothing, however old the data", async () => {
    age(10 * BACKGROUND_REFRESH_AFTER_MS);
    const another = new QueryObserver(client, rolesQuery);
    const off = another.subscribe(() => {});
    await settle();
    expect(api.listRoles).toHaveBeenCalledTimes(1);
    off();
  });

  it("refetches on reconnect, and not on focus while offline", async () => {
    age(BACKGROUND_REFRESH_AFTER_MS + 1);
    onlineManager.setOnline(false);
    await refocus();
    expect(api.listRoles).toHaveBeenCalledTimes(1);
    api.listRoles.mockResolvedValueOnce([role("a", "Parent (edited elsewhere)")]);
    onlineManager.setOnline(true);
    await settle();
    expect(api.listRoles).toHaveBeenCalledTimes(2);
    expect(roles()[0]!.name).toBe("Parent (edited elsewhere)");
  });

  it("skips the refetch while a write to the same resource is in flight", async () => {
    const write = deferred<Role>();
    api.updateRole.mockReturnValueOnce(write.promise);
    const editing = run(client, editRole, { role: roles()[0]!, body: { name: "Coach" } });
    await settle();
    age(BACKGROUND_REFRESH_AFTER_MS + 1);
    await refocus();
    expect(api.listRoles).toHaveBeenCalledTimes(1);
    write.resolve(role("a", "Coach"));
    await editing;
    expect(roles()[0]!.name).toBe("Coach");
  });

  it("an edit made while a refresh is in flight keeps the edit (the refresh's answer is dropped)", async () => {
    age(BACKGROUND_REFRESH_AFTER_MS + 1);
    const list = deferred<Role[]>();
    api.listRoles.mockReturnValueOnce(list.promise);
    await refocus(); // the refresh is now waiting on the server
    expect(api.listRoles).toHaveBeenCalledTimes(2);
    const write = deferred<Role>();
    api.updateRole.mockReturnValueOnce(write.promise);
    const editing = run(client, editRole, { role: roles()[0]!, body: { name: "Coach" } });
    await settle();
    list.resolve([role("a", "Parent")]); // sent before the write: the old name
    await settle();
    expect(roles()[0]!.name).toBe("Coach"); // still the edit, not the old name
    write.reject(new Error("offline")); // and the bookkeeping survived: it rolls back cleanly
    await editing;
    expect(roles()[0]!.name).toBe("Parent");
  });

  it("a failed refresh keeps the data on screen, with one toast and no load banner", async () => {
    age(BACKGROUND_REFRESH_AFTER_MS + 1);
    api.listRoles.mockRejectedValue(new Error("Server unreachable"));
    await refocus();
    const result = observer.getCurrentResult();
    expect(result.data!.map((r) => r.name)).toEqual(["Parent"]);
    expect(loadError(result, "Failed to load roles")).toBeNull();
    expect(toastMock.error).toHaveBeenCalledWith("Server unreachable");
    // The data is still old, so the next return retries at once; failing
    // again within a few seconds doesn't toast again.
    age(1000);
    await refocus();
    expect(api.listRoles).toHaveBeenCalledTimes(3);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });

  it("a failed first load still shows the banner, not a toast", async () => {
    const fresh = createQueryClient();
    api.listRoles.mockRejectedValueOnce(new Error("DB down"));
    const first = new QueryObserver(fresh, rolesQuery);
    const off = first.subscribe(() => {});
    await settle();
    expect(loadError(first.getCurrentResult(), "Failed to load roles")).toBe("DB down");
    expect(toastMock.error).not.toHaveBeenCalled();
    off();
  });

  it("leaves disabled queries alone", async () => {
    const disabled = new QueryObserver(client, {
      queryKey: ["flow"],
      queryFn: vi.fn(async () => "fetched"),
      initialData: "idle",
      enabled: false,
    });
    const off = disabled.subscribe(() => {});
    age(BACKGROUND_REFRESH_AFTER_MS + 1);
    await refocus();
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await settle();
    expect(client.getQueryData(["flow"])).toBe("idle");
    off();
  });
});
