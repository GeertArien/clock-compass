import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaExportRepository } from "./export-repository.js";

/** A model delegate whose findMany records that it was read. */
function model(name: string, accessed: Set<string>, rows: unknown[] = []) {
  return {
    findMany: async () => {
      accessed.add(name);
      return rows;
    },
  };
}

describe("PrismaExportRepository", () => {
  it("dumps every backed-up table and NEVER reads secrets/device rows", async () => {
    const accessed = new Set<string>();
    const db = {
      missionStatement: model("missionStatement", accessed, [{ id: "m1" }]),
      role: model("role", accessed),
      goal: model("goal", accessed),
      project: model("project", accessed),
      task: model("task", accessed, [{ id: "t1" }]),
      person: model("person", accessed),
      ebaEntry: model("ebaEntry", accessed),
      commitment: model("commitment", accessed),
      commitmentParticipant: model("commitmentParticipant", accessed),
      commitmentLog: model("commitmentLog", accessed),
      habit: model("habit", accessed),
      habitMark: model("habitMark", accessed),
      weeklyIntention: model("weeklyIntention", accessed),
      renewalActivity: model("renewalActivity", accessed),
      // Secrets / device-bound rows — reading any of these is a leak.
      apiKey: model("apiKey", accessed),
      pushSubscription: model("pushSubscription", accessed),
      notificationSettings: model("notificationSettings", accessed),
    } as unknown as PrismaClient;

    const data = await new PrismaExportRepository(db).dumpAll();

    // Excluded tables must never be touched, and must not appear in the bundle.
    for (const secret of ["apiKey", "pushSubscription", "notificationSettings"]) {
      expect(accessed.has(secret)).toBe(false);
    }
    const keys = Object.keys(data);
    expect(keys).not.toContain("apiKeys");
    expect(keys).not.toContain("pushSubscriptions");
    expect(keys).not.toContain("notificationSettings");

    // The included tables are read and passed through.
    expect(accessed.has("task")).toBe(true);
    expect(data.tasks).toEqual([{ id: "t1" }]);
    expect(data.missionStatements).toEqual([{ id: "m1" }]);
  });
});
