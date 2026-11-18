import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastStore } from "./toast";

afterEach(() => vi.useRealTimers());

describe("ToastStore", () => {
  it("queues toasts and auto-dismisses them", () => {
    vi.useFakeTimers();
    const toast = new ToastStore();
    toast.success("Saved");
    toast.error("Failed");
    expect(toast.state.items.map((t) => t.kind)).toEqual(["success", "error"]);
    vi.advanceTimersByTime(3000);
    expect(toast.state.items.map((t) => t.message)).toEqual(["Failed"]);
    vi.advanceTimersByTime(2000);
    expect(toast.state.items).toEqual([]);
  });

  it("dismisses a toast by id", () => {
    const toast = new ToastStore();
    const id = toast.info("Hello");
    toast.dismiss(id);
    expect(toast.state.items).toEqual([]);
  });
});
