import type { NotificationFacts } from "../domain/notifications.js";
import type { PeopleService } from "./people-service.js";
import type { TaskService } from "./task-service.js";

/**
 * The facts the push scheduler judges (`dueNotifications`): overdue
 * relationship commitments, and the big rocks not yet done, by the one big
 * rocks rule (`TaskService.bigRocks`, #98).
 */
export async function notificationFacts(
  sources: { people: Pick<PeopleService, "overdue">; tasks: Pick<TaskService, "bigRocks"> },
  now: Date = new Date(),
): Promise<NotificationFacts> {
  const [overdue, rocks] = await Promise.all([sources.people.overdue(now), sources.tasks.bigRocks()]);
  return {
    overdue: overdue.map((o) => ({ personName: o.personName, title: o.title })),
    openRocks: rocks.filter((t) => t.status !== "DONE").map((t) => ({ title: t.title })),
  };
}
