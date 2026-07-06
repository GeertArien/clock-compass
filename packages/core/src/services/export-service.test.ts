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

  it("carries no secret keys into the envelope", async () => {
    const repo: ExportRepository = { dumpAll: async () => emptyData() };
    const bundle = await new ExportService(repo).export();
    expect(Object.keys(bundle.data)).not.toContain("apiKeys");
    expect(JSON.stringify(bundle)).not.toMatch(/hashedKey|apiKey|pushSubscription/i);
  });
});
