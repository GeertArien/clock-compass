import { beforeEach, describe, expect, it, vi } from "vitest";
import { MutationObserver } from "@tanstack/react-query";
import type { Mission } from "@clock-compass/web-client/api";
import { observe, settled, testQueryClient } from "./test-client";

const api = vi.hoisted(() => ({
  getMission: vi.fn(),
  setMission: vi.fn(),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const { missionQuery, saveMission } = await import("./mission");

const mission = (content: string): Mission =>
  ({
    id: "m1",
    content,
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
  }) as Mission;

describe("mission query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the mission once and keeps it until invalidated", async () => {
    api.getMission.mockResolvedValue(mission("Be present."));
    const client = testQueryClient();
    const { observer, unsubscribe } = observe(client, missionQuery);
    expect((await settled(observer)).data?.content).toBe("Be present.");

    // A second screen reading it shares the cache: no second request.
    const again = observe(client, missionQuery);
    expect(again.observer.getCurrentResult().data?.content).toBe("Be present.");
    expect(api.getMission).toHaveBeenCalledTimes(1);

    api.getMission.mockResolvedValue(mission("Be present, and kind."));
    await client.invalidateQueries();
    expect((await settled(observer)).data?.content).toBe("Be present, and kind.");
    unsubscribe();
    again.unsubscribe();
  });

  it("a failed load shows its error at once (no retry, even offline)", async () => {
    api.getMission.mockRejectedValue(new Error("offline"));
    const client = testQueryClient();
    const { observer, unsubscribe } = observe(client, missionQuery);
    const result = await settled(observer);
    expect(result.isError).toBe(true);
    expect(result.error?.message).toBe("offline");
    expect(api.getMission).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("saving replaces the cached mission and confirms", async () => {
    api.getMission.mockResolvedValue(mission("Old."));
    api.setMission.mockImplementation(async (content: string) => mission(content));
    const client = testQueryClient();
    const { observer, unsubscribe } = observe(client, missionQuery);
    await settled(observer);

    const save = new MutationObserver(client, saveMission(client));
    await save.mutate("New.");
    expect(api.setMission).toHaveBeenCalledWith("New.");
    expect(observer.getCurrentResult().data?.content).toBe("New.");
    expect(api.getMission).toHaveBeenCalledTimes(1); // no refetch needed
    expect(toastMock.success).toHaveBeenCalledWith("Mission saved");
    unsubscribe();
  });

  it("a failed save keeps the saved mission and reports the error", async () => {
    api.getMission.mockResolvedValue(mission("Old."));
    api.setMission.mockRejectedValue(new Error("Server said no"));
    const client = testQueryClient();
    const { observer, unsubscribe } = observe(client, missionQuery);
    await settled(observer);

    const save = new MutationObserver(client, saveMission(client));
    await expect(save.mutate("New.")).rejects.toThrow("Server said no");
    expect(save.getCurrentResult().isError).toBe(true);
    expect(observer.getCurrentResult().data?.content).toBe("Old.");
    expect(toastMock.error).toHaveBeenCalledWith("Server said no");
    expect(toastMock.success).not.toHaveBeenCalled();
    unsubscribe();
  });
});
