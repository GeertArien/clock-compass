import { beforeEach, describe, expect, it } from "vitest";
import { singleProvider } from "../ai/jobs.js";
import { NoopAiProvider } from "../ai/provider.js";
import { dayAtUtc, isoWeekStart } from "../domain/week.js";
import { serverToday } from "./task-service.js";

/** Monday of this week (the server's), stored as a plain date. */
const thisMonday = () => dayAtUtc(isoWeekStart(serverToday()));
import { AiService } from "./ai-service.js";
import { FakeTaskRepository } from "./fake-task-repository.js";
import { notificationFacts } from "./notification-facts.js";
import type { PeopleService } from "./people-service.js";
import type { ProjectService } from "./project-service.js";
import type { RenewalService } from "./renewal-service.js";
import { TaskService } from "./task-service.js";

/**
 * #98: one big rocks rule everywhere, pinned until unpinned (what the app's
 * rocks jar shows). The REST endpoint, the MCP tool, the push nudge, the
 * weekly review and the assistant all read `TaskService.bigRocks`.
 */
describe("big rocks: one rule (#98)", () => {
  let repo: FakeTaskRepository;
  let service: TaskService;
  const ids: Record<string, string> = {};

  /** Pin a task the way the web app does: isBigRock plus the browser's Monday. */
  async function pinned(key: string, input: { important?: boolean; urgent?: boolean }, plannedWeek: Date) {
    const task = await service.create({ title: key, important: input.important ?? true, urgent: input.urgent ?? false });
    await service.update(task.id, { isBigRock: true, plannedWeek });
    ids[key] = task.id;
  }

  beforeEach(async () => {
    repo = new FakeTaskRepository();
    service = new TaskService(repo);
    // Brussels' Monday midnight of the current week: not the server's (UTC)
    // Monday, so the old exact-match query found nothing.
    const brusselsMonday = new Date(thisMonday().getTime() - 60 * 60 * 1000);
    const earlierWeek = new Date(thisMonday().getTime() - 21 * 24 * 60 * 60 * 1000);
    await pinned("other zone", {}, brusselsMonday);
    await pinned("urgent", { urgent: true }, brusselsMonday);
    await pinned("earlier week", {}, earlierWeek);
    await pinned("done", {}, brusselsMonday);
    await service.complete(ids["done"]!);
    await pinned("archived", {}, brusselsMonday);
    await repo.update(ids["archived"]!, { status: "ARCHIVED" });
    await pinned("unpinned", {}, brusselsMonday);
    await service.setBigRock(ids["unpinned"]!, false);
    await service.create({ title: "never pinned", important: true, urgent: false });
  });

  const titles = (tasks: { title: string }[]) => tasks.map((t) => t.title).sort();

  it("returns every pinned task whatever its planned week or quadrant, done ones included, archived and unpinned ones not", async () => {
    expect(titles(await service.bigRocks())).toEqual(["done", "earlier week", "other zone", "urgent"]);
  });

  it("is exactly the tasks the app shows as rocks (isBigRock and not archived in the task list)", async () => {
    const all = await service.list();
    expect(titles(await service.bigRocks())).toEqual(titles(all.filter((t) => t.isBigRock && t.status !== "ARCHIVED")));
  });

  it("feeds the push nudge the same rocks, minus the done one", async () => {
    const people = { overdue: async () => [] } as unknown as PeopleService;
    const facts = await notificationFacts({ people, tasks: service });
    expect(titles(facts.openRocks)).toEqual(["earlier week", "other zone", "urgent"]);
  });

  it("feeds the weekly review the same rocks", async () => {
    const ai = new AiService(
      singleProvider(new NoopAiProvider()),
      service,
      { list: async () => [] } as unknown as ProjectService,
      { overdue: async () => [] } as unknown as PeopleService,
      { summary: async () => [] } as unknown as RenewalService,
    );
    const context = await ai.reviewContext();
    expect(titles(context.bigRocks)).toEqual(titles(await service.bigRocks()));
    expect(context.bigRocks.find((r) => r.title === "done")).toEqual({ title: "done", done: true });
  });
});
