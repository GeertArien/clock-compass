import { describe, expect, it } from "vitest";
import type { PersonOverview } from "@clock-compass/web-client/api";
import { peopleCheckData } from "./live-ports";

const person = (id: string, commitmentIds: string[]) =>
  ({ id, name: id, commitments: commitmentIds.map((c) => ({ id: c, title: c })) }) as unknown as PersonOverview;

describe("peopleCheckData (#109 step 4)", () => {
  it("links each commitment to the people it is shown under", () => {
    expect(peopleCheckData([person("mum", ["call"]), person("noor", ["outing", "call"])])).toEqual({
      people: [{ id: "mum" }, { id: "noor" }],
      commitments: [
        { id: "call", personIds: ["mum", "noor"] },
        { id: "outing", personIds: ["noor"] },
      ],
    });
  });

  it("checks nothing about people before they have loaded", () => {
    expect(peopleCheckData(undefined)).toEqual({});
  });
});

describe("livePorts.refresh (review of #124)", () => {
  it("reloads what an operation touched even when no screen shows it, so the next proposal is checked against it", async () => {
    const { queryClient } = await import("@/lib/query-client");
    const { livePorts, cachedCheckData } = await import("./live-ports");
    const { peopleQuery } = await import("@/lib/queries/people");
    let fetched = 0;
    // A list loaded earlier and no longer on screen (no observer).
    await queryClient.prefetchQuery({
      queryKey: peopleQuery.queryKey,
      queryFn: async () => {
        fetched++;
        return [person("mum", fetched > 1 ? ["call", "new"] : ["call"])];
      },
    });
    expect(fetched).toBe(1);
    await livePorts.refresh(["people"]);
    expect(fetched).toBe(2);
    expect(cachedCheckData()?.commitments).toEqual([
      { id: "call", personIds: ["mum"] },
      { id: "new", personIds: ["mum"] },
    ]);
    expect(cachedCheckData()?.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
