import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { PersonOverview } from "@clock-compass/web-client/api";
import { observe, run, settled, testQueryClient } from "./test-client";

const api = vi.hoisted(() => ({
  listPeople: vi.fn(),
  createPerson: vi.fn(async () => ({})),
  deletePerson: vi.fn(async () => undefined),
  createCommitment: vi.fn(async () => ({})),
  deleteCommitment: vi.fn(async () => undefined),
  logOccurrence: vi.fn(async () => ({})),
  addEbaEntry: vi.fn(async () => ({})),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const { addEba, addPerson, logCommitment, peopleQuery, removePerson, worstOverdue } = await import(
  "./people"
);

const person = (id: string, name: string, statuses: string[] = []): PersonOverview =>
  ({
    id,
    name,
    relationship: null,
    commitments: statuses.map((status, i) => ({ id: `${id}-c${i}`, title: `${name} ${i}`, status })),
  }) as unknown as PersonOverview;

let client: QueryClient;
const people = () => client.getQueryData(peopleQuery.queryKey);

describe("people query", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    api.listPeople.mockReset();
    client = testQueryClient();
    api.listPeople.mockResolvedValueOnce([person("p1", "Sam")]);
    await client.fetchQuery(peopleQuery);
  });

  it("a write toasts and reloads the derived overview", async () => {
    api.listPeople.mockResolvedValueOnce([person("p1", "Sam"), person("p2", "Ana")]);
    await run(client, addPerson, { name: "Ana", relationship: "kid" });
    expect(api.createPerson).toHaveBeenCalledWith({ name: "Ana", relationship: "kid" });
    expect(toastMock.success).toHaveBeenCalledWith("Person added");
    expect(people()?.map((p) => p.name)).toEqual(["Sam", "Ana"]);
  });

  it("passes each write's arguments through", async () => {
    api.listPeople.mockResolvedValue([person("p1", "Sam")]);
    await run(client, logCommitment, { commitmentId: "c1", personId: "p1" });
    expect(api.logOccurrence).toHaveBeenCalledWith("c1", { personId: "p1", note: undefined });
    await run(client, addEba, { personId: "p1", kind: "DEPOSIT", note: "Pancakes" });
    expect(api.addEbaEntry).toHaveBeenCalledWith("p1", { kind: "DEPOSIT", note: "Pancakes" });
    expect(toastMock.success).toHaveBeenCalledTimes(1); // the EBA entry has no toast
    await run(client, removePerson, "p1");
    expect(api.deletePerson).toHaveBeenCalledWith("p1");
  });

  it("a failed write toasts and doesn't reload", async () => {
    api.createPerson.mockRejectedValueOnce(new Error("Name taken"));
    await run(client, addPerson, { name: "Sam" });
    expect(toastMock.error).toHaveBeenCalledWith("Name taken");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(api.listPeople).toHaveBeenCalledTimes(1); // only the initial load
  });

  it("a failed reload after a write is a toast, not the screen's load error", async () => {
    const { observer, unsubscribe } = observe(client, peopleQuery);
    api.listPeople.mockRejectedValueOnce(new Error("offline"));
    await run(client, removePerson, "p1");
    expect(toastMock.success).toHaveBeenCalledWith("Person removed");
    expect(toastMock.error).toHaveBeenCalledWith("offline");
    const result = await settled(observer);
    expect(result.isError).toBe(false);
    expect(result.data?.map((p) => p.name)).toEqual(["Sam"]); // kept as it was
    unsubscribe();
  });
});

describe("worstOverdue", () => {
  it("names the first overdue commitment", () => {
    expect(worstOverdue([person("a", "Sam", ["ON_TRACK"]), person("b", "Ana", ["DUE_SOON", "OVERDUE"])])).toEqual({
      personName: "Ana",
      title: "Ana 1",
    });
    expect(worstOverdue([person("a", "Sam", ["ON_TRACK"])])).toBeNull();
  });
});
