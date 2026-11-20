import { startOfIsoWeek } from "../domain/week.js";
import type { AiJob, AiJobs } from "../ai/jobs.js";
import type {
  AiProvider,
  TaskClassification,
  WeeklyReviewContext,
} from "../ai/provider.js";
import type { TaskService, TaskWithQuadrant } from "./task-service.js";
import type { ProjectService, ProjectWithProgress } from "./project-service.js";
import type { PeopleService } from "./people-service.js";
import type { RenewalService } from "./renewal-service.js";

export interface AiIntakeResult {
  task: TaskWithQuadrant;
  classification: TaskClassification;
}

/** The deterministic Habit-2 flag: work that connects to no goal. */
export interface UnalignedReport {
  tasks: TaskWithQuadrant[];
  projects: ProjectWithProgress[];
}

/**
 * The AI jobs (build-order step 7). This service owns context composition and
 * persistence; the provider owns the model calls. Everything works without AI
 * except the calls that genuinely need it — `unaligned` is deterministic.
 * Each job asks `jobs` which provider and model to use (the seam for #94).
 */
export class AiService {
  constructor(
    private readonly jobs: AiJobs,
    private readonly tasks: TaskService,
    private readonly projects: ProjectService,
    private readonly people: PeopleService,
    private readonly renewal: RenewalService,
  ) {}

  private provider(job: AiJob): AiProvider {
    return this.jobs.forJob(job).provider;
  }

  /** Whether AI is configured for the single-call jobs. */
  get available(): boolean {
    return this.provider("classifyTask").available;
  }

  /** Classify a sentence without creating anything (the capture preview). */
  classify(text: string, now: Date = new Date()): Promise<TaskClassification> {
    return this.provider("classifyTask").classifyTask(text, now.toISOString().slice(0, 10));
  }

  /** NL intake: POST a sentence → classify → create the task. */
  async intake(text: string, now: Date = new Date()): Promise<AiIntakeResult> {
    const classification = await this.classify(text, now);
    const task = await this.tasks.create({
      title: classification.title,
      important: classification.important,
      urgent: classification.urgent,
      proactivity: classification.proactivity,
      dueDate: classification.dueDate ? new Date(classification.dueDate) : null,
    });
    return { task, classification };
  }

  /** Habit 1: tag an existing task influence vs concern and persist it. */
  async tagTask(taskId: string): Promise<TaskWithQuadrant> {
    const task = await this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    const proactivity = await this.provider("tagProactivity").tagProactivity(task.title, task.notes);
    return this.tasks.update(taskId, { proactivity });
  }

  /** Habit 2: refine a mission statement draft (caller decides whether to save). */
  refineMission(draft: string): Promise<string> {
    return this.provider("refineMission").refineMission(draft);
  }

  /** Deterministic Habit-2 flag: open tasks and projects that serve no goal. */
  async unaligned(): Promise<UnalignedReport> {
    const [tasks, projects] = await Promise.all([
      this.tasks.list({ status: "TODO", goalId: null }),
      this.projects.list(),
    ]);
    return {
      tasks,
      projects: projects.filter((p) => !p.goalId && p.status !== "DONE"),
    };
  }

  /** Compose the week's snapshot and ask the provider for the review prose. */
  async weeklyReview(now: Date = new Date()): Promise<{ summary: string; generatedAt: string }> {
    const context = await this.reviewContext(now);
    const summary = await this.provider("weeklyReview").weeklyReview(context);
    return { summary, generatedAt: now.toISOString() };
  }

  /** Exposed for tests: the exact context the review prompt sees. */
  async reviewContext(now: Date = new Date()): Promise<WeeklyReviewContext> {
    const weekStart = startOfIsoWeek(now);
    const [rocks, overdue, renewalSummary, unaligned] = await Promise.all([
      this.tasks.bigRocks(),
      this.people.overdue(now),
      this.renewal.summary(now),
      this.unaligned(),
    ]);
    return {
      weekLabel: `Week of ${weekStart.toISOString().slice(0, 10)}`,
      bigRocks: rocks.map((t) => ({ title: t.title, done: t.status === "DONE" })),
      overdueCommitments: overdue.map((o) => ({ person: o.personName, title: o.title })),
      renewal: renewalSummary.map((d) => ({
        dimension: d.dimension,
        done: d.total,
        target: d.habitsTarget,
      })),
      unalignedTaskCount: unaligned.tasks.length,
      unalignedProjectCount: unaligned.projects.length,
    };
  }
}
