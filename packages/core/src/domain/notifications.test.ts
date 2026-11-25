import { describe, expect, it } from "vitest";
import type { NotificationSettings } from "@prisma/client";
import { dueNotifications, type NotificationFacts } from "./notifications.js";

function settings(partial: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    id: "s",
    overdueCommitments: true,
    morningRocks: true,
    weeklyReview: true,
    morningHour: 8,
    quietStart: 22,
    quietEnd: 8,
    timeZone: null,
    lastOverdueSentAt: null,
    lastMorningSentAt: null,
    lastReviewSentAt: null,
    updatedAt: new Date(),
    ...partial,
  };
}

const facts: NotificationFacts = {
  overdue: [{ personName: "Noor", title: "One-on-one" }],
  openRocks: [{ title: "Ship MCP adapter" }, { title: "Long run" }],
};

// Wednesday 10:00 local.
const wednesday = new Date("2026-06-10T10:00:00");

describe("dueNotifications", () => {
  it("sends overdue + morning rocks on a weekday morning", () => {
    const pending = dueNotifications(settings(), facts, wednesday);
    expect(pending.map((p) => p.kind)).toEqual(["overdue", "morningRocks"]);
    expect(pending[0]!.body).toMatch(/Noor/);
    expect(pending[1]!.body).toMatch(/2 big rocks/);
  });

  it("sends nothing during quiet hours (window wraps midnight)", () => {
    const night = new Date("2026-06-10T23:30:00");
    expect(dueNotifications(settings(), facts, night)).toEqual([]);
    const earlyMorning = new Date("2026-06-10T06:00:00");
    expect(dueNotifications(settings(), facts, earlyMorning)).toEqual([]);
  });

  it("dedupes: at most one of each kind per day", () => {
    const sent = settings({
      lastOverdueSentAt: new Date("2026-06-10T08:30:00"),
      lastMorningSentAt: new Date("2026-06-10T08:30:00"),
    });
    expect(dueNotifications(sent, facts, wednesday)).toEqual([]);
    // A new day resets the stamps' effect.
    const thursday = new Date("2026-06-11T10:00:00");
    expect(dueNotifications(sent, facts, thursday)).toHaveLength(2);
  });

  it("respects the per-kind toggles", () => {
    const off = settings({ overdueCommitments: false, morningRocks: false });
    expect(dueNotifications(off, facts, wednesday)).toEqual([]);
  });

  it("holds the morning reminder until the configured hour", () => {
    const early = new Date("2026-06-10T08:30:00");
    const lateRiser = settings({ morningHour: 9, overdueCommitments: false });
    expect(dueNotifications(lateRiser, facts, early)).toEqual([]);
  });

  it("sends the weekly review on Sunday evening only", () => {
    const sundayEvening = new Date("2026-06-14T18:00:00");
    const pending = dueNotifications(
      settings({ overdueCommitments: false, morningRocks: false }),
      facts,
      sundayEvening,
    );
    expect(pending.map((p) => p.kind)).toEqual(["weeklyReview"]);
    const sundayNoon = new Date("2026-06-14T12:00:00");
    expect(
      dueNotifications(
        settings({ overdueCommitments: false, morningRocks: false }),
        facts,
        sundayNoon,
      ),
    ).toEqual([]);
  });

  it("stays silent when there is nothing to say", () => {
    expect(
      dueNotifications(settings(), { overdue: [], openRocks: [] }, wednesday),
    ).toEqual([]);
  });
});
