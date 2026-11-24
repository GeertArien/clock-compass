import { isoWeekStart, resolveClock, type DayClock } from "../domain/week.js";
import { zonedDay } from "../domain/zoned.js";
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
import { DEFAULT_DATA_POLICY, type DataPolicy } from "../assistant/data-policy.js";
import { AiUnavailableError, jobOffReason, sends } from "../ai/settings.js";

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
 * Each job asks `jobs` which provider and model to use, and sends only what
 * the data switches allow (`JOB_DATA` in ai/settings.ts, #94): a job whose
 * data is all switched off throws `AiUnavailableError` with the reason.
 */
export class AiService {
  constructor(
    private readonly jobs: AiJobs,
    private readonly tasks: TaskService,
    private readonly projects: ProjectService,
    private readonly people: PeopleService,
    private readonly renewal: RenewalService,
    private readonly policy: () => DataPolicy = () => DEFAULT_DATA_POLICY,
  ) {}

  /** The policy in force, after checking the job may run under it. */
  private allowed(job: AiJob): DataPolicy {
    const policy = this.policy();
    const off = jobOffReason(job, policy);
    if (off) throw new AiUnavailableError(off);
    return policy;
  }

  private provider(job: AiJob): AiProvider {
    return this.jobs.forJob(job).provider;
  }

  /** Whether AI is configured for the single-call jobs. */
  get available(): boolean {
    return this.provider("classifyTask").available;
  }

  /**
   * Classify a sentence without creating anything (the capture preview).
   * "Today" for "by Friday" is the caller's (#112).
   */
  async classify(text: string, clock: DayClock = {}): Promise<TaskClassification> {
    this.allowed("classifyTask");
    const { now, timeZone } = resolveClock(clock);
    return this.provider("classifyTask").classifyTask(text, zonedDay(now, timeZone));
  }

  /** NL intake: POST a sentence → classify → create the task. */
  async intake(text: string, clock: DayClock = {}): Promise<AiIntakeResult> {
    const classification = await this.classify(text, clock);
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
    const policy = this.allowed("tagProactivity");
    const task = await this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    // The title alone when task notes are not shared.
    const notes = sends("tagProactivity", "the task's notes", policy) ? task.notes : null;
    const proactivity = await this.provider("tagProactivity").tagProactivity(task.title, notes);
    return this.tasks.update(taskId, { proactivity });
  }

  /** Habit 2: refine a mission statement draft (caller decides whether to save). */
  async refineMission(draft: string): Promise<string> {
    this.allowed("refineMission");
    return this.provider("refineMission").refineMission(draft);
  }

  /** Deterministic Habit-2 flag: open tasks and projects that serve no goal. */
  async unaligned(): Promise<UnalignedReport> {
    const [tasks, projects] = await Promise.all([
      // Open tasks shown now: not "later" occurrences of a recurring task (#105).
      this.tasks.list({ status: "TODO", goalId: null, shown: true }),
      this.projects.list(),
    ]);
    return {
      tasks,
      projects: projects.filter((p) => !p.goalId && p.status !== "DONE"),
    };
  }

  /** Compose the week's snapshot and ask the provider for the review prose. */
  async weeklyReview(clock: DayClock = {}): Promise<{ summary: string; generatedAt: string }> {
    const { now } = resolveClock(clock);
    const context = await this.reviewContext(clock);
    const summary = await this.provider("weeklyReview").weeklyReview(context);
    return { summary, generatedAt: now.toISOString() };
  }

  /** Exposed for tests: the exact context the review prompt sees. */
  async reviewContext(clock: DayClock = {}): Promise<WeeklyReviewContext> {
    const policy = this.allowed("weeklyReview");
    const has = (label: string) => sends("weeklyReview", label, policy);
    const resolved = resolveClock(clock);
    const weekStart = isoWeekStart(zonedDay(resolved.now, resolved.timeZone));
    const [rocks, overdue, renewalSummary, unaligned] = await Promise.all([
      has("big rock titles and whether they are done") ? this.tasks.bigRocks(resolved) : null,
      has("overdue commitments (person name and commitment title)") ? this.people.overdue(resolved.now) : null,
      has("renewal counts per dimension") ? this.renewal.summary(resolved) : null,
      has("counts of tasks and projects with no goal") ? this.unaligned() : null,
    ]);
    // A section whose data is not shared is left out of the prompt.
    return {
      weekLabel: `Week of ${weekStart}`,
      ...(rocks ? { bigRocks: rocks.map((t) => ({ title: t.title, done: t.status === "DONE" })) } : {}),
      ...(overdue ? { overdueCommitments: overdue.map((o) => ({ person: o.personName, title: o.title })) } : {}),
      ...(renewalSummary
        ? { renewal: renewalSummary.map((d) => ({ dimension: d.dimension, done: d.total, target: d.habitsTarget })) }
        : {}),
      ...(unaligned
        ? { unalignedTaskCount: unaligned.tasks.length, unalignedProjectCount: unaligned.projects.length }
        : {}),
    };
  }
}
