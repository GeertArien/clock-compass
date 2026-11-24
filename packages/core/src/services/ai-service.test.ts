import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DATA_POLICY, type DataPolicy } from "../assistant/data-policy.js";
import { AiUnavailableError } from "../ai/settings.js";
import type { ProactivityTag } from "@prisma/client";
import type {
  AiProvider,
  TaskClassification,
  WeeklyReviewContext,
} from "../ai/provider.js";
import { AiService } from "./ai-service.js";
import { singleProvider } from "../ai/jobs.js";
import type { CreateTaskInput, TaskService, TaskWithQuadrant } from "./task-service.js";
import type { ProjectService } from "./project-service.js";
import type { PeopleService } from "./people-service.js";
import type { RenewalService } from "./renewal-service.js";

class FakeProvider implements AiProvider {
  readonly available = true;
  classification: TaskClassification = {
    title: "Take Noor to the climbing gym",
    important: true,
    urgent: false,
    proactivity: "INFLUENCE",
    dueDate: "2026-06-13",
    rationale: "Relationship time is Quadrant II.",
  };
  lastReviewContext: WeeklyReviewContext | null = null;

  async classifyTask(): Promise<TaskClassification> {
    return this.classification;
  }
  lastTagged: { title: string; notes: string | null | undefined } | null = null;
  async tagProactivity(title: string, notes?: string | null): Promise<ProactivityTag> {
    this.lastTagged = { title, notes };
    return "CONCERN";
  }
  async refineMission(draft: string): Promise<string> {
    return `refined: ${draft}`;
  }
  async weeklyReview(context: WeeklyReviewContext): Promise<string> {
    this.lastReviewContext = context;
    return "A good week.";
  }
}

function fakeTask(partial: Partial<TaskWithQuadrant>): TaskWithQuadrant {
  const now = new Date();
  return {
    id: "task_1",
    title: "t",
    notes: null,
    important: false,
    urgent: false,
    status: "TODO",
    proactivity: null,
    isBigRock: false,
    plannedWeek: null,
    dueDate: null,
    completedAt: null,
    scheduledDay: null,
    scheduledTime: null,
    goalId: null,
    projectId: null,
    seriesId: null,
    previousId: null,
    slotDate: null,
    showFrom: null,
    later: false,
    recurrence: null,
    source: "MANUAL",
    externalId: null,
    externalPriority: null,
    createdAt: now,
    updatedAt: now,
    quadrant: "Q4",
    ...partial,
  };
}

describe("AiService", () => {
  let provider: FakeProvider;
  let createdInput: CreateTaskInput | null;
  let service: AiService;
  let policy: DataPolicy;

  beforeEach(() => {
    provider = new FakeProvider();
    createdInput = null;

    const tasks = {
      create: async (input: CreateTaskInput) => {
        createdInput = input;
        return fakeTask({ title: input.title, important: !!input.important });
      },
      get: async () => fakeTask({ id: "task_9", title: "Worry about the news", notes: "The election coverage" }),
      update: async (_id: string, input: { proactivity?: ProactivityTag | null }) =>
        fakeTask({ id: "task_9", proactivity: input.proactivity ?? null }),
      list: async () => [fakeTask({ id: "loose", goalId: null })],
      bigRocks: async () => [
        fakeTask({ id: "rock1", title: "Long run", status: "DONE" }),
        fakeTask({ id: "rock2", title: "One-on-one with Noor" }),
      ],
    } as unknown as TaskService;

    const projects = {
      list: async () => [
        { id: "p1", name: "Aligned", goalId: "g1", status: "ACTIVE" },
        { id: "p2", name: "Garage clear-out", goalId: null, status: "ACTIVE" },
        { id: "p3", name: "Old", goalId: null, status: "DONE" },
      ],
    } as unknown as ProjectService;

    const people = {
      overdue: async () => [
        { personId: "n", personName: "Noor", commitmentId: "c", title: "One-on-one", lastOccurredAt: null },
      ],
    } as unknown as PeopleService;

    const renewal = {
      summary: async () => [
        { dimension: "PHYSICAL", habitsDone: 3, habitsTarget: 4, oneOffs: 1, total: 4 },
      ],
    } as unknown as RenewalService;

    policy = DEFAULT_DATA_POLICY;
    service = new AiService(singleProvider(provider), tasks, projects, people, renewal, () => policy);
  });

  it("intake creates the task from the classification", async () => {
    const result = await service.intake("take noor climbing saturday");
    expect(createdInput).toMatchObject({
      title: "Take Noor to the climbing gym",
      important: true,
      urgent: false,
      proactivity: "INFLUENCE",
    });
    expect(createdInput?.dueDate).toEqual(new Date("2026-06-13"));
    expect(result.classification.rationale).toMatch(/Quadrant II/);
  });

  it("tagTask persists the provider's influence/concern judgment", async () => {
    const task = await service.tagTask("task_9");
    expect(task.proactivity).toBe("CONCERN");
  });

  it("unaligned reports loose tasks and non-done unlinked projects", async () => {
    const report = await service.unaligned();
    expect(report.tasks.map((t) => t.id)).toEqual(["loose"]);
    expect(report.projects.map((p) => p.id)).toEqual(["p2"]);
  });

  it("weeklyReview composes the week's snapshot for the prompt", async () => {
    const { summary } = await service.weeklyReview({ now: new Date("2026-06-10T12:00:00Z"), timeZone: "UTC" });
    expect(summary).toBe("A good week.");
    const ctx = provider.lastReviewContext!;
    expect(ctx.bigRocks).toEqual([
      { title: "Long run", done: true },
      { title: "One-on-one with Noor", done: false },
    ]);
    expect(ctx.overdueCommitments).toEqual([{ person: "Noor", title: "One-on-one" }]);
    expect(ctx.renewal![0]).toMatchObject({ dimension: "PHYSICAL", done: 4, target: 4 });
    expect(ctx.unalignedTaskCount).toBe(1);
    expect(ctx.unalignedProjectCount).toBe(1);
  });

  describe("the data switches (#94): only what the policy allows reaches the prompt", () => {
    const when = { now: new Date("2026-06-10T12:00:00Z"), timeZone: "UTC" };

    it("tags influence or concern from the title alone when task notes are off", async () => {
      await service.tagTask("task_9");
      expect(provider.lastTagged).toEqual({ title: "Worry about the news", notes: "The election coverage" });
      policy = { ...DEFAULT_DATA_POLICY, taskNotes: false };
      await service.tagTask("task_9");
      expect(provider.lastTagged).toEqual({ title: "Worry about the news", notes: null });
    });

    it("leaves a weekly review section out when its category is off", async () => {
      policy = { ...DEFAULT_DATA_POLICY, people: false, habitsAndRenewal: false };
      await service.weeklyReview(when);
      const ctx = provider.lastReviewContext!;
      expect(Object.keys(ctx).sort()).toEqual(["bigRocks", "unalignedProjectCount", "unalignedTaskCount", "weekLabel"]);
      expect(JSON.stringify(ctx)).not.toContain("Noor\",\"title\":\"One-on-one");
    });

    it("needs both tasks and goals for the counts of work with no goal", async () => {
      policy = { ...DEFAULT_DATA_POLICY, goalsAndProjects: false };
      await service.weeklyReview(when);
      expect(provider.lastReviewContext).not.toHaveProperty("unalignedTaskCount");
      expect(provider.lastReviewContext).toHaveProperty("bigRocks");
    });

    it("refuses the weekly review with all its data off, mission refinement with the mission off, classification with tasks off", async () => {
      policy = { ...DEFAULT_DATA_POLICY, tasks: false, people: false, habitsAndRenewal: false };
      await expect(service.weeklyReview(when)).rejects.toBeInstanceOf(AiUnavailableError);
      await expect(service.classify("call mum")).rejects.toThrow("Task classification is off because tasks are not shared with AI (Settings → AI).");
      policy = { ...DEFAULT_DATA_POLICY, mission: false };
      await expect(service.refineMission("Be kind")).rejects.toThrow(/mission is not shared/);
    });
  });
});
