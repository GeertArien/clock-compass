/**
 * The MCP App's screens (issue #118), built on the server: which data, in
 * which order, in which catalog component. The MCP adapter only registers
 * them. Each screen reads through the same services as the read tools, under
 * the same data policy, and is validated with the validator the assistant's
 * `render_a2ui` uses before anything is sent.
 *
 * The week and the people are built from the catalog's primitive components
 * (Card, Column, Text, Divider), which need no live data. The matrix and the
 * habits (step 2) use the app's own live components (QuadrantBoard,
 * HabitCheckIn): the result then also carries the reads those components
 * need (`reads`), answered by the read tools' own handlers under the same
 * data policy, so the page draws them without asking the host for anything.
 */
import {
  MAX_READ_TASKS,
  SCREENS,
  type A2uiMessage,
  type ReadName,
  type ScreenName,
  zodErrorText,
} from "@clock-compass/assistant-catalog";
import { renderSurface } from "../assistant/render.js";
import { addDays, isoWeekStart, type PlainDay } from "../domain/week.js";
import { zonedDay } from "../domain/zoned.js";
import { scheduledDayOf } from "../domain/scheduled-day.js";
import { runRead, type ReadContext, type ReadServices } from "../reads/handlers.js";
import type { DataPolicy } from "../assistant/data-policy.js";

export type ScreenOutcome =
  | {
      ok: true;
      /** One line for the host's model. */
      summary: string;
      /** The A2UI messages the page draws (validated). */
      messages: A2uiMessage[];
      /**
       * What the screen's live components read, answered here so the page
       * needs no call of its own: each a read tool's name, its arguments and
       * its answer (the page reads the same tools through the host to refresh).
       */
      reads?: ScreenRead[];
    }
  | { ok: false; error: string };

type Component = Record<string, unknown>;

/** One read a screen answered for its page. */
export interface ScreenRead {
  name: ReadName;
  args: Record<string, unknown>;
  result: unknown;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "23 November" from a plain day. */
function dayMonth(day: PlainDay): string {
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]}`;
}

/** "23–29 November 2026", or "30 November – 6 December 2026" across a month. */
function weekRange(monday: PlainDay, sunday: PlainDay): string {
  const [y1, m1, d1] = monday.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = sunday.split("-").map(Number) as [number, number, number];
  if (m1 === m2) return `${d1}–${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1} ${MONTHS[m1 - 1]}${y1 === y2 ? "" : ` ${y1}`} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

/**
 * The week in words (#118): the text answer every host's model reads, and
 * all a host that draws no page shows. It says everything the card shows.
 */
function weekInWords(
  monday: PlainDay,
  days: PlainDay[],
  rocks: { title: string; status: string }[],
  scheduled: { task: { title: string; status: string; scheduledTime: string | null }; day: PlainDay }[],
  ctx: ReadContext,
): string {
  const thisWeek = monday === isoWeekStart(zonedDay(ctx.now, ctx.timeZone));
  const range = weekRange(monday, days[6]!);
  const head = thisWeek ? `This week (${range}, ${ctx.timeZone}):` : `The week of ${range}:`;
  const done = rocks.filter((r) => r.status === "DONE").length;
  const rockWords = rocks.length
    ? `${rocks.length} big rock${rocks.length === 1 ? "" : "s"}, ${done} done: ${rocks.map((r) => `${r.title}${r.status === "DONE" ? " ✓" : ""}`).join(", ")}.`
    : "No big rocks pinned.";
  const dayWords = days
    .map((day, i) => {
      const onDay = scheduled.filter((s) => s.day === day);
      if (!onDay.length) return null;
      const items = onDay.map(({ task }) => `${task.scheduledTime ? `${task.scheduledTime} ` : ""}${task.title}${task.status === "DONE" ? " ✓" : ""}`);
      return `${DAY_NAMES[i]} ${Number(day.slice(8))}: ${items.join(", ")}.`;
    })
    .filter(Boolean);
  return [head, rockWords, ...(dayWords.length ? dayWords : ["Nothing is scheduled."])].join(" ");
}

function screenAllowed(name: ScreenName, policy: DataPolicy): boolean {
  return SCREENS[name].categories.some((c) => policy[c]);
}

async function showWeek(input: { week?: string }, services: ReadServices, ctx: ReadContext): Promise<ScreenOutcome> {
  const clock = { now: ctx.now, timeZone: ctx.timeZone };
  const monday = input.week ?? isoWeekStart(zonedDay(ctx.now, ctx.timeZone));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const [rocks, open] = await Promise.all([
    services.tasks.bigRocks(clock),
    services.tasks.list({ shown: true }, clock),
  ]);
  const scheduled = open
    .filter((t) => t.status !== "ARCHIVED" && t.scheduledDay)
    // A plain date (#136): the same day in every zone.
    .map((t) => ({ task: t, day: scheduledDayOf(t.scheduledDay)! }))
    .filter(({ day }) => day >= monday && day <= days[6]!)
    // Day, then time, untimed last. A plain comparison: localeCompare would
    // put "~" before the digits.
    .sort((a, b) => {
      const ka = a.day + (a.task.scheduledTime ?? "~");
      const kb = b.day + (b.task.scheduledTime ?? "~");
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  const components: Component[] = [];
  const text = (id: string, value: string, variant?: string) =>
    components.push({ id, component: "Text", text: value, ...(variant ? { variant } : {}) });
  const children: string[] = [];

  text("title", `## Week of ${dayMonth(monday)}`);
  children.push("title");

  text("rocks_head", "**Big rocks**");
  children.push("rocks_head");
  if (rocks.length === 0) {
    text("rocks_none", "No big rocks pinned.", "caption");
    children.push("rocks_none");
  }
  rocks.forEach((r, i) => {
    text(`rock_${i}`, `${r.status === "DONE" ? "✓" : "○"} ${r.title}`);
    children.push(`rock_${i}`);
  });

  components.push({ id: "divider", component: "Divider" });
  children.push("divider");

  days.forEach((day, i) => {
    const onDay = scheduled.filter((s) => s.day === day);
    text(`day_${i}`, `**${DAY_NAMES[i]} ${dayMonth(day).split(" ")[0]}**`);
    children.push(`day_${i}`);
    if (onDay.length === 0) {
      text(`day_${i}_none`, "Nothing scheduled", "caption");
      children.push(`day_${i}_none`);
    }
    onDay.forEach(({ task }, j) => {
      const done = task.status === "DONE" ? "✓ " : "";
      text(`day_${i}_${j}`, `${done}${task.scheduledTime ? `${task.scheduledTime} ` : ""}${task.title}`);
      children.push(`day_${i}_${j}`);
    });
  });

  components.unshift(
    { id: "root", component: "Card", child: "column" },
    { id: "column", component: "Column", children, align: "stretch" },
  );

  const rendered = renderSurface({ surfaceId: `week-${monday}`, components });
  if (!rendered.ok) return { ok: false, error: `The week could not be drawn: ${rendered.errors.join("; ")}` };
  return {
    ok: true,
    summary: weekInWords(monday, days, rocks, scheduled, ctx),
    messages: rendered.messages,
  };
}

/** Builds a screen's surface from its components, validated like the assistant's. */
function surface(surfaceId: string, components: Component[], what: string): { ok: true; messages: A2uiMessage[] } | { ok: false; error: string } {
  const rendered = renderSurface({ surfaceId, components });
  return rendered.ok ? { ok: true, messages: rendered.messages } : { ok: false, error: `${what} could not be drawn: ${rendered.errors.join("; ")}` };
}

const QUADRANT_WORDS = {
  Q1: "Q1 urgent and important",
  Q2: "Q2 important, not urgent",
  Q3: "Q3 urgent, not important",
  Q4: "Q4 neither",
} as const;

interface MatrixTask {
  id: string;
  title: string;
  quadrant: keyof typeof QUADRANT_WORDS;
  isBigRock: boolean;
}

/**
 * The matrix (#118, step 2): the open tasks in the app's own QuadrantBoard,
 * with live task cards. The page gets the tasks, and the goals and projects
 * the cards name, from the reads in the result.
 */
async function showMatrix(_input: Record<string, never>, services: ReadServices, ctx: ReadContext): Promise<ScreenOutcome> {
  const taskArgs = { limit: MAX_READ_TASKS };
  const listed = await runRead("listTasks", taskArgs, services, ctx);
  if (!listed.ok) return listed;
  const { total, tasks } = listed.result as { total: number; tasks: MatrixTask[] };
  // A card shows no notes, so none travel to the page, whatever the switch says.
  const withoutNotes = {
    ...(listed.result as object),
    tasks: (tasks as (MatrixTask & { notes?: unknown })[]).map(({ notes: _notes, ...t }) => t),
  };
  const reads: ScreenRead[] = [{ name: "listTasks", args: taskArgs, result: withoutNotes }];
  // The goals and projects a card names, only when they are shared; the
  // mission is never needed here, so it is left out of what the page gets.
  if (ctx.policy.goalsAndProjects) {
    const compass = await runRead("getCompass", {}, services, ctx);
    if (compass.ok) {
      const { goals, projects } = compass.result as { goals?: unknown[]; projects?: unknown[] };
      reads.push({ name: "getCompass", args: {}, result: { goals: goals ?? [], projects: projects ?? [] } });
    }
  }

  const components: Component[] = [
    { id: "root", component: "Column", children: tasks.length ? ["title", "board"] : ["title", "none"] },
    { id: "title", component: "Text", text: "## Your tasks by quadrant" },
    tasks.length
      ? { id: "board", component: "QuadrantBoard", taskIds: tasks.map((t) => t.id) }
      : { id: "none", component: "Text", text: "No open tasks.", variant: "caption" },
  ];
  const drawn = surface("matrix", components, "The matrix");
  if (!drawn.ok) return drawn;

  const quadrants = (Object.keys(QUADRANT_WORDS) as MatrixTask["quadrant"][]).map((q) => {
    const inQ = tasks.filter((t) => t.quadrant === q);
    const names = inQ.map((t) => `${t.title}${t.isBigRock ? " (big rock)" : ""}`);
    return `${QUADRANT_WORDS[q]} (${inQ.length})${names.length ? `: ${names.join(", ")}` : ""}.`;
  });
  const head = tasks.length < total ? `Your open tasks by quadrant (the first ${tasks.length} of ${total}):` : `Your open tasks by quadrant (${total}):`;
  return { ok: true, summary: [head, ...quadrants].join(" "), messages: drawn.messages, reads };
}

interface HabitRead {
  id: string;
  name: string;
  dimension: string | null;
  targetPerWeek: number;
  doneThisWeek: number;
  markedToday: boolean;
  streak: number;
}

const DIMENSION_WORDS: Record<string, string> = {
  PHYSICAL: "physical",
  MENTAL: "mental",
  SOCIAL_EMOTIONAL: "social/emotional",
  SPIRITUAL: "spiritual",
};

/** The habits (#118, step 2): today's check-in, in the app's own HabitCheckIn. */
async function showHabits(_input: Record<string, never>, services: ReadServices, ctx: ReadContext): Promise<ScreenOutcome> {
  const listed = await runRead("listHabits", {}, services, ctx);
  if (!listed.ok) return listed;
  const habits = listed.result as HabitRead[];
  const components: Component[] = [
    { id: "root", component: "Column", children: ["title", habits.length ? "checkin" : "none"] },
    { id: "title", component: "Text", text: "## Habits today" },
    habits.length
      ? { id: "checkin", component: "HabitCheckIn", habitIds: habits.map((h) => h.id) }
      : { id: "none", component: "Text", text: "No habits yet.", variant: "caption" },
  ];
  const drawn = surface("habits", components, "The habits");
  if (!drawn.ok) return drawn;
  const words = habits.map((h) => {
    const dim = h.dimension ? ` (${DIMENSION_WORDS[h.dimension] ?? h.dimension.toLowerCase()})` : "";
    const streak = h.streak ? `, a ${h.streak}-week streak` : "";
    return `${h.name}${dim}: ${h.doneThisWeek} of ${h.targetPerWeek} this week, ${h.markedToday ? "done today" : "not yet today"}${streak}.`;
  });
  const summary = habits.length ? ["Habits this week:", ...words].join(" ") : "No habits yet.";
  return { ok: true, summary, messages: drawn.messages, reads: [{ name: "listHabits", args: {}, result: listed.result }] };
}

interface PersonRead {
  name: string;
  relationship: string | null;
  commitments: {
    title: string;
    cadence: { unit: string; every: number };
    status: "ON_TRACK" | "DUE_SOON" | "OVERDUE";
    lastDone: PlainDay | null;
  }[];
  emotionalBankAccountBalance?: number;
}

const STATUS_WORDS = { ON_TRACK: "on track", DUE_SOON: "due soon", OVERDUE: "overdue" } as const;
const STATUS_MARK = { ON_TRACK: "○", DUE_SOON: "◐", OVERDUE: "●" } as const;

/** "every month", "every 2 weeks". */
function cadenceWords({ unit, every }: { unit: string; every: number }): string {
  const noun = unit.toLowerCase();
  return every === 1 ? `every ${noun}` : `every ${every} ${noun}s`;
}

/** "Monthly adventure: every month, overdue, last done 12 September". */
function commitmentWords(c: PersonRead["commitments"][number]): string {
  const last = c.lastDone ? `, last done ${dayMonth(c.lastDone)}` : ", not done yet";
  return `${c.title}: ${cadenceWords(c.cadence)}, ${STATUS_WORDS[c.status]}${last}`;
}

/**
 * The people (#118, step 2): each person with their commitments and where
 * each stands, from primitives like the week (the catalog has no people
 * component). Notes on people never reach it, whatever the switches say.
 */
async function showPeople(input: { status?: "OVERDUE" | "DUE_SOON" }, services: ReadServices, ctx: ReadContext): Promise<ScreenOutcome> {
  const args = input.status ? { status: input.status } : {};
  const listed = await runRead("listPeople", args, services, ctx);
  if (!listed.ok) return listed;
  const people = listed.result as PersonRead[];

  const components: Component[] = [];
  const children: string[] = [];
  const text = (id: string, value: string, variant?: string) => {
    components.push({ id, component: "Text", text: value, ...(variant ? { variant } : {}) });
    children.push(id);
  };
  text("title", input.status ? `## ${input.status === "OVERDUE" ? "Overdue" : "Due soon"}` : "## Your people");
  if (people.length === 0) text("none", input.status ? `Nothing is ${STATUS_WORDS[input.status]}.` : "No people yet.", "caption");
  people.forEach((p, i) => {
    if (i > 0) {
      components.push({ id: `div_${i}`, component: "Divider" });
      children.push(`div_${i}`);
    }
    text(`person_${i}`, `**${p.name}**${p.relationship ? ` · ${p.relationship}` : ""}`);
    if (p.emotionalBankAccountBalance !== undefined) {
      const b = p.emotionalBankAccountBalance;
      text(`balance_${i}`, `Emotional bank account: ${b > 0 ? "+" : ""}${b}`, "caption");
    }
    if (p.commitments.length === 0) text(`person_${i}_none`, "No commitments.", "caption");
    p.commitments.forEach((c, j) => text(`person_${i}_${j}`, `${STATUS_MARK[c.status]} ${commitmentWords(c)}`));
  });
  components.unshift(
    { id: "root", component: "Card", child: "column" },
    { id: "column", component: "Column", children, align: "stretch" },
  );
  const drawn = surface(input.status ? `people-${input.status.toLowerCase()}` : "people", components, "The people");
  if (!drawn.ok) return drawn;

  const words = people.map(
    (p) => `${p.name}${p.relationship ? ` (${p.relationship})` : ""}: ${p.commitments.length ? p.commitments.map(commitmentWords).join("; ") : "no commitments"}.`,
  );
  const summary = people.length
    ? words.join(" ")
    : input.status
      ? `Nothing is ${STATUS_WORDS[input.status]}.`
      : "No people yet.";
  return { ok: true, summary, messages: drawn.messages };
}

const HANDLERS: { [N in ScreenName]: (input: never, services: ReadServices, ctx: ReadContext) => Promise<ScreenOutcome> } = {
  showWeek,
  showMatrix,
  showHabits,
  showPeople,
};

/** Builds one screen, refusing what the policy or the input does not allow. */
export async function runScreen(name: ScreenName, args: unknown, services: ReadServices, ctx: ReadContext): Promise<ScreenOutcome> {
  if (!screenAllowed(name, ctx.policy)) return { ok: false, error: "This shows data the user has not shared with AI." };
  const parsed = SCREENS[name].input.safeParse(args ?? {});
  if (!parsed.success) return { ok: false, error: `Invalid arguments: ${zodErrorText(parsed.error)}` };
  try {
    return await HANDLERS[name](parsed.data as never, services, ctx);
  } catch (err) {
    ctx.onError?.(name, err);
    return { ok: false, error: "Building that screen failed. Try again or answer without it." };
  }
}
