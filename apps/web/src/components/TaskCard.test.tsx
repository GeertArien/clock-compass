import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Task } from "@clock-compass/web-client/api";
import { goalsQuery } from "@/lib/queries/goals";
import { ReadOnlyContext } from "@/lib/read-only";
import { TaskCard, type ProposedPart } from "./TaskCard";

const task: Task = {
  id: "t1",
  title: "Plan the garden",
  notes: null,
  important: true,
  urgent: false,
  quadrant: "Q2",
  status: "TODO",
  proactivity: "INFLUENCE",
  isBigRock: true,
  plannedWeek: null,
  dueDate: "2027-11-01T00:00:00.000Z",
  completedAt: null,
  scheduledDay: null,
  scheduledTime: null,
  goalId: null,
  projectId: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

function render(proposal?: { changed: ReadonlySet<ProposedPart> }, inPage = false) {
  const client = new QueryClient();
  client.setQueryData(goalsQuery.queryKey, [{ id: "g1", title: "A warm house" }] as never);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ReadOnlyContext.Provider value={inPage}>
        <TaskCard task={task} proposal={proposal} />
      </ReadOnlyContext.Provider>
    </QueryClientProvider>,
  );
}

/** The action tooltips a live card offers. */
const ACTION_TITLES = /title="(Complete|Reopen|Pin as big rock|Unpin big rock|Edit|Delete)"/;

const controls = (html: string) => [...html.matchAll(/<(button|select)\b[^>]*>/g)].map((m) => m[0]);

describe("the task card inside an unconfirmed proposal (#145)", () => {
  it("live: every control can be used, with the pencil and the bin", () => {
    const html = render();
    expect(controls(html).every((c) => !/\sdisabled=""/.test(c))).toBe(true);
    expect(html).toMatch(/aria-label="Edit task"/);
    expect(html).toMatch(/aria-label="Delete task"/);
  });

  it("in a proposal: nothing can be pressed or reached with Tab, and no pencil or bin", () => {
    const html = render({ changed: new Set() });
    const found = controls(html);
    expect(found.length).toBeGreaterThan(0);
    // A disabled button or select is left out of the Tab order by the browser.
    for (const control of found) expect(control).toMatch(/\sdisabled=""/);
    expect(html).not.toMatch(/Edit task|Delete task/);
    // The circle and the star say what the task is, not an action it cannot take.
    expect(html).toMatch(/aria-label="Not done"/);
    expect(html).toMatch(/aria-label="Big rock"/);
  });

  it("marks the changed parts with a dot and a hidden word for a screen reader", () => {
    const html = render({ changed: new Set<ProposedPart>(["urgent", "due", "bigRock"]) });
    expect(html).toMatch(/Urgent<span class="sr-only"> \(changed\)<\/span>/);
    expect(html).toMatch(/Due Nov 1, 2027<span class="sr-only"> \(changed\)<\/span>/);
    expect(html).toMatch(/aria-label="Big rock \(changed\)"/);
    expect(html.match(/bg-\[var\(--pine\)\]/g)).toHaveLength(3);
    // Unchanged parts carry neither.
    expect(html).not.toMatch(/Important<span class="sr-only">/);
  });

  it("in the MCP App page (ReadOnlyContext), with no proposal: read-only the same way (#118)", () => {
    const html = render(undefined, true);
    const found = controls(html);
    expect(found.length).toBeGreaterThan(0);
    for (const control of found) expect(control).toMatch(/\sdisabled=""/);
    expect(html).not.toMatch(/Edit task|Delete task/);
    expect(html).toMatch(/aria-label="Not done"/);
    expect(html).toMatch(/aria-label="Big rock"/);
    // No changed-part marks without a proposal.
    expect(html).not.toMatch(/\(changed\)/);
  });

  it("a read-only card offers no action: no tooltip and no hover effect on a disabled control", () => {
    for (const html of [render({ changed: new Set<ProposedPart>(["bigRock"]) }), render(undefined, true)]) {
      expect(html).not.toMatch(ACTION_TITLES);
      for (const control of controls(html)) expect(control).not.toMatch(/(?<![\w:])hover:/);
    }
    // The live card keeps its tooltips.
    expect(render()).toMatch(ACTION_TITLES);
  });
});
