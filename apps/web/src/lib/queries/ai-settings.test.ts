import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { AiSettings } from "@clock-compass/web-client/api";
import { run, testQueryClient } from "./test-client";

const api = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  addAiProvider: vi.fn(),
  updateAiProvider: vi.fn(),
  removeAiProvider: vi.fn(),
  setAiJobs: vi.fn(),
  setAiDataPolicy: vi.fn(),
}));
vi.mock("@clock-compass/web-client/api", () => api);
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/stores/toast", () => ({ toast: toastMock }));

const { aiSettingsQuery, saveJob, saveProvider, saveSwitch } = await import("./ai-settings");

const settings: AiSettings = {
  providers: [{ id: "p1", name: "Claude", kind: "anthropic", baseUrl: null, keySet: true, keyHint: "WXYZ", models: ["opus", "haiku"], warning: null }],
  jobs: [
    { job: "default", providerId: "p1", model: "opus" },
    { job: "weeklyReview", providerId: "p1", model: "haiku" },
    { job: "assistant", providerId: null, model: null },
  ],
  switches: [],
};

let client: QueryClient;

describe("Settings → AI (#94)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    client = testQueryClient();
    api.getAiSettings.mockResolvedValue(settings);
    await client.fetchQuery(aiSettingsQuery);
  });

  it("changes one job and sends the others as they are", async () => {
    api.setAiJobs.mockResolvedValueOnce(undefined);
    await run(client, saveJob, { job: "assistant", providerId: "p1", model: "haiku" });
    expect(api.setAiJobs).toHaveBeenCalledWith([
      { job: "default", providerId: "p1", model: "opus" },
      { job: "weeklyReview", providerId: "p1", model: "haiku" },
      { job: "assistant", providerId: "p1", model: "haiku" },
    ]);
    // The settings (and the AI status) are marked to reload after the change.
    expect(client.getQueryState(aiSettingsQuery.queryKey)?.isInvalidated).toBe(true);
  });

  it("'use the default' leaves the job out", async () => {
    api.setAiJobs.mockResolvedValueOnce(undefined);
    await run(client, saveJob, { job: "weeklyReview", providerId: null, model: null });
    expect(api.setAiJobs).toHaveBeenCalledWith([{ job: "default", providerId: "p1", model: "opus" }]);
  });

  it("adds a provider with its key, updates one without resending it", async () => {
    api.addAiProvider.mockResolvedValueOnce({ ...settings.providers[0], id: "p2", name: "Gateway" });
    await run(client, saveProvider, { input: { name: "Gateway", kind: "openai-compatible", baseUrl: "http://nas:4000/v1", apiKey: "sk-x" } });
    expect(api.addAiProvider).toHaveBeenCalledWith({ name: "Gateway", kind: "openai-compatible", baseUrl: "http://nas:4000/v1", apiKey: "sk-x" });
    expect(toastMock.success).toHaveBeenCalledWith("Gateway added");

    api.updateAiProvider.mockResolvedValueOnce(settings.providers[0]);
    await run(client, saveProvider, { id: "p1", input: { name: "Claude", models: ["opus"] } });
    expect(api.updateAiProvider).toHaveBeenCalledWith("p1", { name: "Claude", models: ["opus"] });
  });

  it("shows the server's refusal in its own words", async () => {
    api.setAiDataPolicy.mockRejectedValueOnce(new Error("AI settings need the server's own token (API_AUTH_TOKEN), not a generated key."));
    await run(client, saveSwitch, { category: "mission", enabled: false });
    expect(toastMock.error).toHaveBeenCalledWith("Not saved: AI settings need the server's own token (API_AUTH_TOKEN), not a generated key.");
  });
});
