/**
 * The MCP App's screens (issue #118), built on the server: which data, in
 * which order, in which catalog component. The MCP adapter only registers
 * them. Each screen reads through the same services as the read tools, under
 * the same data policy, and is validated with the validator the assistant's
 * `render_a2ui` uses before anything is sent.
 *
 * Step 1 builds from the catalog's primitive components (Card, Column, Row,
 * Text, Divider), which need no live data: the page draws the screen from the
 * tool result alone. Live components come with the data port in step 2.
 */
import { SCREENS, type A2uiMessage, type ScreenName, zodErrorText } from "@clock-compass/assistant-catalog";
import { renderSurface } from "../assistant/render.js";
import { addDays, isoWeekStart, type PlainDay } from "../domain/week.js";
import { zonedDay } from "../domain/zoned.js";
import { scheduledDayOf } from "../domain/scheduled-day.js";
import { type ReadContext, type ReadServices } from "../reads/handlers.js";
import type { DataPolicy } from "../assistant/data-policy.js";

export type ScreenOutcome =
  | {
      ok: true;
      /** One line for the host's model. */
      summary: string;
      /** The A2UI messages the page draws (validated). */
      messages: A2uiMessage[];
    }
  | { ok: false; error: string };

type Component = Record<string, unknown>;

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
    // A plain date (#136): the same day in every zone. The zone only reads one still in the old form.
    .map((t) => ({ task: t, day: scheduledDayOf(t.scheduledDay, ctx.timeZone)! }))
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

const HANDLERS: { [N in ScreenName]: (input: never, services: ReadServices, ctx: ReadContext) => Promise<ScreenOutcome> } = {
  showWeek,
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
