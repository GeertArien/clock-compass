import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ExportService,
} from "./export-service.js";
import type {
  ExportData,
  ExportRepository,
} from "../repositories/export-repository.js";

function emptyData(overrides: Partial<ExportData> = {}): ExportData {
  return {
    missionStatements: [],
    roles: [],
    goals: [],
    projects: [],
    tasks: [],
    taskSeries: [],
    people: [],
    ebaEntries: [],
    commitments: [],
    commitmentParticipants: [],
    commitmentLogs: [],
    habits: [],
    habitMarks: [],
    weeklyIntentions: [],
    renewalActivities: [],
    ...overrides,
  };
}

describe("ExportService", () => {
  it("wraps the dump in a versioned, timestamped envelope", async () => {
    const data = emptyData({
      tasks: [{ id: "t1", title: "Big rock" } as ExportData["tasks"][number]],
    });
    const repo: ExportRepository = { dumpAll: async () => data };
    const service = new ExportService(repo);

    const bundle = await service.export(new Date("2026-06-13T10:00:00Z"));

    expect(bundle.format).toBe(EXPORT_FORMAT);
    expect(bundle.version).toBe(EXPORT_VERSION);
    expect(bundle.exportedAt).toBe("2026-06-13T10:00:00.000Z");
    expect(bundle.data).toBe(data);
    expect(bundle.data.tasks).toHaveLength(1);
  });

  it("carries the rules of recurring tasks and every occurrence, skipped ones included (#105)", async () => {
    const data = emptyData({
      tasks: [
        { id: "t1", seriesId: "s1", status: "DONE", previousId: null } as ExportData["tasks"][number],
        { id: "t2", seriesId: "s1", status: "ARCHIVED", previousId: "t1" } as ExportData["tasks"][number],
        { id: "t3", seriesId: "s1", status: "TODO", previousId: "t2" } as ExportData["tasks"][number],
      ],
      taskSeries: [{ id: "s1", cadenceUnit: "YEAR" } as ExportData["taskSeries"][number]],
    });
    const bundle = await new ExportService({ dumpAll: async () => data }).export();
    expect(Object.keys(bundle.data)).toContain("taskSeries");
    expect(bundle.data.taskSeries).toHaveLength(1);
    expect(bundle.data.tasks.map((t) => t.status)).toEqual(["DONE", "ARCHIVED", "TODO"]);
  });

  it("carries no secret keys into the envelope", async () => {
    const repo: ExportRepository = { dumpAll: async () => emptyData() };
    const bundle = await new ExportService(repo).export();
    expect(Object.keys(bundle.data)).not.toContain("apiKeys");
    expect(JSON.stringify(bundle)).not.toMatch(/hashedKey|apiKey|pushSubscription/i);
  });
});
