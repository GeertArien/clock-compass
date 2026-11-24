import { describe, expect, it } from "vitest";
import { startZoneReporting } from "./time-zone";

function harness(initial: string, fail = false) {
  let zone = initial;
  let failing = fail;
  const reports: string[] = [];
  let foreground: () => void = () => undefined;
  const stop = startZoneReporting({
    zone: () => zone,
    report: async (z) => {
      reports.push(z);
      if (failing) throw new Error("offline");
    },
    onForeground: (listener) => {
      foreground = listener;
      return () => undefined;
    },
  });
  return {
    reports,
    stop,
    move: (z: string) => (zone = z),
    recover: () => (failing = false),
    back: async () => {
      foreground();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("the app reports its zone (#136)", () => {
  it("reports at start, and again only when it returns in another zone", async () => {
    const h = harness("Europe/Brussels");
    await Promise.resolve();
    expect(h.reports).toEqual(["Europe/Brussels"]);
    await h.back();
    expect(h.reports).toEqual(["Europe/Brussels"]);
    h.move("America/New_York");
    await h.back();
    expect(h.reports).toEqual(["Europe/Brussels", "America/New_York"]);
    await h.back();
    expect(h.reports).toHaveLength(2);
  });

  it("tries a failed report again at the next return", async () => {
    const h = harness("Europe/Brussels", true);
    await Promise.resolve();
    await Promise.resolve();
    h.recover();
    await h.back();
    expect(h.reports).toEqual(["Europe/Brussels", "Europe/Brussels"]);
    await h.back();
    expect(h.reports).toHaveLength(2);
  });
});
