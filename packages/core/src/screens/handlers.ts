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
import { localDay, type ReadContext, type ReadServices } from "../reads/handlers.js";
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
    .map((t) => ({ task: t, day: localDay(t.scheduledDay, ctx.timeZone)! }))
    .filter(({ day }) => day >= monday && day <= days[6]!)
    .sort((a, b) => (a.day + (a.task.scheduledTime ?? "~")).localeCompare(b.day + (b.task.scheduledTime ?? "~")));

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
  const doneRocks = rocks.filter((r) => r.status === "DONE").length;
  return {
    ok: true,
    summary: `Shown: the week of ${monday}, ${rocks.length} big rock${rocks.length === 1 ? "" : "s"} (${doneRocks} done), ${scheduled.length} scheduled task${scheduled.length === 1 ? "" : "s"}.`,
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
