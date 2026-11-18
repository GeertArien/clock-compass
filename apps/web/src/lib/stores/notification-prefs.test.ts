import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationSettings } from "@clock-compass/web-client/api";

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
vi.mock("./toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { notificationPrefsStore: store } = await import("./notification-prefs");

/** A save whose response the test settles by hand. */
function deferredSave() {
  let resolve!: (s: NotificationSettings) => void;
  let reject!: (err: Error) => void;
  api.updateNotificationSettings.mockImplementationOnce(
    () => new Promise<NotificationSettings>((res, rej) => ((resolve = res), (reject = rej))),
  );
  return { resolve: (s: NotificationSettings) => resolve(s), reject: () => reject(new Error("offline")) };
}

describe("notificationPrefsStore", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    api.getNotificationSettings.mockResolvedValueOnce({ ...base });
    await store.load();
  });

  it.each(["first-first", "second-first"] as const)(
    "two quick toggles that both fail end where they started (%s)",
    async (order) => {
      const a = deferredSave();
      const b = deferredSave();
      const saveA = store.save({ morningRocks: false });
      const saveB = store.save({ weeklyReview: false });
      expect(store.state.settings).toMatchObject({ morningRocks: false, weeklyReview: false });
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
      expect(store.state.settings).toEqual(base);
    },
  );

  it("one failure keeps the other toggle's success", async () => {
    const a = deferredSave();
    const b = deferredSave();
    const saveA = store.save({ morningRocks: false });
    const saveB = store.save({ weeklyReview: false });
    a.reject();
    await saveA;
    b.resolve({ ...base, weeklyReview: false });
    await saveB;
    expect(store.state.settings).toEqual({ ...base, weeklyReview: false });
  });

  it("a late response to an older save doesn't overwrite a newer one", async () => {
    const a = deferredSave();
    const b = deferredSave();
    const saveA = store.save({ morningHour: 8 });
    const saveB = store.save({ morningHour: 9 });
    b.resolve({ ...base, morningHour: 9 });
    await saveB;
    a.resolve({ ...base, morningHour: 8 });
    await saveA;
    expect(store.state.settings?.morningHour).toBe(9);
  });

  it("keeps no tracking id in the exposed settings", async () => {
    api.updateNotificationSettings.mockResolvedValueOnce({ ...base, quietStart: 23 });
    await store.save({ quietStart: 23 });
    expect(store.state.settings).toEqual({ ...base, quietStart: 23 });
  });
});
