/**
 * Fake services for the assistant's tests: just the reads the tools make,
 * seeded with sentinel notes that must never reach a tool result under the
 * default policy.
 */
import type { AssistantServices } from "./tools.js";

export const PERSON_NOTE = "SENTINEL-PERSON-NOTE: private";
export const EBA_NOTE = "SENTINEL-EBA-ENTRY-NOTE: private";

const at = new Date("2026-11-18T09:00:00Z");

const task = (id: string, title: string, important: boolean, urgent: boolean, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  notes: null,
  important,
  urgent,
  quadrant: important && urgent ? "Q1" : important ? "Q2" : urgent ? "Q3" : "Q4",
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
  createdAt: at,
  updatedAt: at,
  later: false,
  showFrom: null,
  recurrence: null,
  ...extra,
});

export const TASKS = [
  // Scheduled for Saturday 21 Nov from a browser in Europe/Brussels (stored as
  // its local midnight), due Friday 27 Nov (a plain date, stored as UTC midnight).
  task("t1", "Plan the garden", true, false, {
    goalId: "g1",
    isBigRock: true,
    scheduledDay: new Date("2026-11-21T00:00:00.000Z"),
    scheduledTime: "09:00",
    dueDate: new Date("2026-11-27T00:00:00.000Z"),
  }),
  task("t2", "Reply to overdue email", false, true),
  task("t3", "Call the plumber", true, true, { notes: "Ask about the boiler too" }),
  // A yearly task's next occurrence that shows later (#105): not open work yet.
  task("t4", "Buitenkraan afsluiten", true, false, {
    dueDate: new Date("2027-11-01T00:00:00.000Z"),
    showFrom: new Date("2027-10-11T00:00:00.000Z"),
    later: true,
    recurrence: { unit: "YEAR", every: 1, from: "SCHEDULE", leadDays: 21, active: true },
  }),
];

export function fakeServices(): AssistantServices {
  const people = [
    {
      id: "p1",
      name: "Sam",
      relationship: "kid",
      notes: PERSON_NOTE,
      balance: 3,
      ledger: [{ id: "e1", kind: "DEPOSIT", note: EBA_NOTE, occurredAt: at.toISOString() }],
      commitments: [
        {
          id: "c1",
          title: "Monthly adventure",
          cadenceUnit: "MONTH",
          cadenceValue: 1,
          status: "OVERDUE",
          lastOccurredAt: "2026-09-12T00:00:00.000Z",
          nextDueAt: "2026-10-12T00:00:00.000Z",
          history: [true, true, false, true, true, true, false, false],
        },
        {
          id: "c2",
          title: "Bedtime story",
          cadenceUnit: "WEEK",
          cadenceValue: 1,
          status: "ON_TRACK",
          lastOccurredAt: at.toISOString(),
          nextDueAt: null,
          history: [false, true, true, true, true, true, true, true],
        },
      ],
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    },
  ];
  return {
    tasks: {
      list: async (filter: { status?: string; goalId?: string; projectId?: string; shown?: boolean } = {}) =>
        TASKS.filter(
          (t) =>
            (!filter.shown || !t.later) &&
            (!filter.status || t.status === filter.status) &&
            (!filter.goalId || t.goalId === filter.goalId) &&
            (!filter.projectId || t.projectId === filter.projectId),
        ),
      // The one rule (#98): pinned until unpinned, archived ones left out.
      bigRocks: async () => TASKS.filter((t) => t.isBigRock && t.status !== "ARCHIVED"),
    },
    goals: {
      list: async () => [
        {
          id: "g1",
          title: "Grow our own vegetables",
          description: "A garden the kids help with",
          status: "ACTIVE",
          targetDate: null,
          roleId: "r1",
          order: 0,
          dimension: null,
          createdAt: at,
          updatedAt: at,
          progress: { done: 1, total: 3, ratio: 1 / 3 },
        },
      ],
    },
    projects: {
      list: async () => [
        {
          id: "pr1",
          name: "Garden makeover",
          description: null,
          status: "ACTIVE",
          goalId: "g1",
          createdAt: at,
          updatedAt: at,
          progress: { done: 0, total: 2, ratio: 0 },
        },
      ],
    },
    roles: {
      list: async () => [{ id: "r1", name: "Parent", mission: "Be present", order: 0, createdAt: at, updatedAt: at }],
    },
    mission: {
      getActive: async () => ({ id: "m1", content: "Put first things first.", isActive: true, createdAt: at, updatedAt: at }),
    },
    people: {
      overview: async () => people,
      overdue: async () => [
        { personId: "p1", personName: "Sam", commitmentId: "c1", title: "Monthly adventure", lastOccurredAt: "2026-09-12T00:00:00.000Z" },
      ],
    },
    renewal: {
      listHabits: async () => [
        {
          id: "h1",
          name: "Morning run",
          dimension: "PHYSICAL",
          goalId: null,
          goalTitle: null,
          targetPerWeek: 3,
          weekDays: [true, false, true, false, false, false, false],
          doneThisWeek: 2,
          markedToday: false,
          streak: 4,
        },
      ],
      summary: async () => [
        { dimension: "PHYSICAL", habitsDone: 2, habitsTarget: 3, oneOffs: 1, total: 3 },
      ],
      intentions: async () => [{ dimension: "PHYSICAL", text: "Three runs this week" }],
    },
  } as unknown as AssistantServices;
}
