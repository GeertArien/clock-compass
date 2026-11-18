import { afterEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryObserver, notifyManager } from "@tanstack/react-query";
import { createQueryClient } from "./query-client";

describe("query client notifications", () => {
  afterEach(() => vi.useRealTimers());

  it("delivers an optimistic write to observers before any timer runs", async () => {
    // With the library's default scheduler (setTimeout(0)) a frame could be
    // painted between the write and the re-render; timers are frozen here, so
    // only a microtask delivery reaches the observer.
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    const client = createQueryClient();
    client.setQueryData(["pick"], "old");
    const observer = new QueryObserver<string>(client, { queryKey: ["pick"], enabled: false });
    const seen: (string | undefined)[] = [];
    // Subscribed the way useQuery subscribes a component (through batchCalls,
    // which delivers on the notify scheduler).
    const unsubscribe = observer.subscribe(
      notifyManager.batchCalls((r: { data?: string }) => void seen.push(r.data)),
    );
    void new MutationObserver(client, {
      mutationFn: () => new Promise<string>(() => {}),
      onMutate: (value: string) => void client.setQueryData(["pick"], value),
    }).mutate("new");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(seen).toContain("new");
    unsubscribe();
  });
});
