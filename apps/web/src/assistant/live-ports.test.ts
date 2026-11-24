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
