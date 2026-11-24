import type { NotificationSettings } from "@prisma/client";
import { isoWeekday, serverZone } from "./week.js";
import { zonedDay } from "./zoned.js";

/** One notification the scheduler decided to send. */
export interface PendingNotification {
  kind: "overdue" | "morningRocks" | "weeklyReview";
  title: string;
  body: string;
  /** Where a tap should land in the app. */
  url: string;
}

/** The snapshot the decision function looks at (composed by the caller). */
export interface NotificationFacts {
  overdue: { personName: string; title: string }[];
  /** This week's big rocks not yet done. */
  openRocks: { title: string }[];
}

function isQuiet(hour: number, settings: NotificationSettings): boolean {
  const { quietStart, quietEnd } = settings;
  if (quietStart === quietEnd) return false;
  // The window may wrap midnight (e.g. 22 → 8).
  return quietStart < quietEnd
    ? hour >= quietStart && hour < quietEnd
    : hour >= quietStart || hour < quietEnd;
}

/** The hour (0–23) on the wall clock of `timeZone` at `instant`. */
function zonedHour(instant: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(instant);
  return Number(hour);
}

/**
 * Pure scheduling judgment: given the settings, the dedupe stamps, and the
 * week's facts, decide what to send right now. Rules from the design:
 * overdue nudge at most once a day, morning rocks at the configured hour,
 * weekly review on Sunday evening — and nothing during quiet hours.
 *
 * Hours and days are read in `timeZone`: the server's (`TZ`), since a push
 * has no device asking (#112).
 */
export function dueNotifications(
  settings: NotificationSettings,
  facts: NotificationFacts,
  now: Date = new Date(),
  timeZone: string = serverZone(),
): PendingNotification[] {
  const hour = zonedHour(now, timeZone);
  const today = zonedDay(now, timeZone);
  const sameDay = (a: Date | null) => !!a && zonedDay(a, timeZone) === today;
  if (isQuiet(hour, settings)) return [];

  const pending: PendingNotification[] = [];

  if (
    settings.overdueCommitments &&
    facts.overdue.length > 0 &&
    !sameDay(settings.lastOverdueSentAt)
  ) {
    const first = facts.overdue[0]!;
    pending.push({
      kind: "overdue",
      title: "A relationship needs you",
      body:
        facts.overdue.length === 1
          ? `No ${first.title.toLowerCase()} with ${first.personName} logged on cadence.`
          : `${facts.overdue.length} commitments are overdue — starting with ${first.personName}.`,
      url: "/?go=compass.people",
    });
  }

  if (
    settings.morningRocks &&
    hour >= settings.morningHour &&
    facts.openRocks.length > 0 &&
    !sameDay(settings.lastMorningSentAt)
  ) {
    pending.push({
      kind: "morningRocks",
      title: "Rocks first",
      body:
        facts.openRocks.length === 1
          ? `One big rock this week: ${facts.openRocks[0]!.title}`
          : `${facts.openRocks.length} big rocks still to place this week.`,
      url: "/?go=clock.today",
    });
  }

  // Sunday from 17:00 — the moment to look back and plan the week.
  if (
    settings.weeklyReview &&
    isoWeekday(today) === 7 &&
    hour >= 17 &&
    !sameDay(settings.lastReviewSentAt)
  ) {
    pending.push({
      kind: "weeklyReview",
      title: "The week, in review",
      body: "Read the record and set next week's intentions.",
      url: "/?go=almanac.review",
    });
  }

  return pending;
}
