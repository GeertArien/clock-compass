import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { NotificationSettings } from "@clock-compass/web-client/api";
import { run, testQueryClient, tick } from "./test-client";

const base: NotificationSettings = {
  overdueCommitments: true,
  morningRocks: true,
  weeklyReview: true,
  morningHour: 7,
  quietStart: 22,
  quietEnd: 7,
};

const api = vi.hoisted(() => ({
  getNotificationSettings: vi.fn(),
  updateNotificationSettings: vi.fn(),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const { notificationSettingsQuery: query, saveNotificationSettings: save } = await import(
  "./notification-prefs"
);

/** A save whose response the test settles by hand. */
function deferredSave() {
  let resolve!: (s: NotificationSettings) => void;
  let reject!: (err: Error) => void;
  api.updateNotificationSettings.mockImplementationOnce(
    () => new Promise<NotificationSettings>((res, rej) => ((resolve = res), (reject = rej))),
  );
  return { resolve: (s: NotificationSettings) => resolve(s), reject: () => reject(new Error("offline")) };
}

let client: QueryClient;
const settings = () => client.getQueryData(query.queryKey);

describe("notification settings", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    client = testQueryClient();
    api.getNotificationSettings.mockResolvedValueOnce({ ...base });
    await client.fetchQuery(query);
  });

  it.each(["first-first", "second-first"] as const)(
    "two quick toggles that both fail end where they started (%s)",
    async (order) => {
      const a = deferredSave();
      const b = deferredSave();
      const saveA = run(client, save, { morningRocks: false });
      const saveB = run(client, save, { weeklyReview: false });
      await tick();
      expect(settings()).toMatchObject({ morningRocks: false, weeklyReview: false });
      if (order === "first-first") {
        a.reject();
        await saveA;
        b.reject();
        await saveB;
      } else {
        b.reject();
        await saveB;
        a.reject();
        await saveA;
      }
      expect(settings()).toEqual(base);
      expect(toastMock.error).toHaveBeenCalledWith("offline");
    },
  );

  it("one failure keeps the other toggle's success", async () => {
    const a = deferredSave();
    const b = deferredSave();
    const saveA = run(client, save, { morningRocks: false });
    const saveB = run(client, save, { weeklyReview: false });
    await tick();
    a.reject();
    await saveA;
    b.resolve({ ...base, weeklyReview: false });
    await saveB;
    expect(settings()).toEqual({ ...base, weeklyReview: false });
  });

  it("a late response to an older save doesn't overwrite a newer one", async () => {
    const a = deferredSave();
    const b = deferredSave();
    const saveA = run(client, save, { morningHour: 8 });
    const saveB = run(client, save, { morningHour: 9 });
    await tick();
    b.resolve({ ...base, morningHour: 9 });
    await saveB;
    a.resolve({ ...base, morningHour: 8 });
    await saveA;
    expect(settings()?.morningHour).toBe(9);
  });

  it("keeps no tracking id in the cached settings", async () => {
    api.updateNotificationSettings.mockResolvedValueOnce({ ...base, quietStart: 23 });
    await run(client, save, { quietStart: 23 });
    expect(settings()).toEqual({ ...base, quietStart: 23 });
  });
});
