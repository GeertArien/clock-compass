/**
 * Dev-only preview of the assistant's A2UI renderer (issue #62): one surface
 * per catalog fixture, hand-written A2UI 1.0 rendered through the official
 * React renderer with the app's own components, reading real tasks, goals and
 * habits from the server through the query modules. Every sent action is
 * listed with what `parseAction` makes of it (no write runs here).
 *
 * Open /a2ui-preview.html on the Vite dev server. `?theme=dark` starts in
 * dark mode; `?only=<surfaceId>` shows one surface. The renderer and
 * fixtures are loaded with `import()`, as the assistant sheet will load them.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Goal, Task } from "@clock-compass/web-client/api";
import { weekDays } from "@clock-compass/web-client/week";
import { queryClient } from "@/lib/query-client";
import { tasksQuery, useTasksQuery } from "@/lib/queries/tasks";
import { goalsQuery } from "@/lib/queries/goals";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import "../../app.css";

type Renderer = typeof import("../a2ui/renderer");
type Catalog = typeof import("@clock-compass/assistant-catalog");

/** Up to three open tasks, big rocks and Q2 first: what a week plan would propose. */
function pickRocks(tasks: Task[]): string[] {
  const open = tasks.filter((t) => t.status !== "DONE");
  const rank = (t: Task) => (t.isBigRock ? 0 : t.quadrant === "Q2" ? 1 : 2);
  return [...open].sort((a, b) => rank(a) - rank(b)).slice(0, 3).map((t) => t.id);
}

/** A local date as YYYY-MM-DD, the form the actions take. */
const isoDate = (d: Date) =>
  [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
const tomorrow = () => isoDate(new Date(Date.now() + 86_400_000));
const thisMonday = () => isoDate(weekDays()[0]!);

interface Sent {
  action: unknown;
  parsed: ReturnType<Catalog["parseAction"]>;
}

function Preview() {
  const params = new URLSearchParams(location.search);
  const only = params.get("only");
  const [dark, setDark] = useState(() => params.get("theme") === "dark");
  const [surface, setSurface] = useState<{
    renderer: Renderer;
    processor: ReturnType<Renderer["createProcessor"]>;
  } | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const { error } = useTasksQuery();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.body.style.background = "var(--background)";
    document.body.style.color = "var(--foreground)";
  }, [dark]);

  // Load the renderer as the assistant sheet will (import()), then build the
  // surfaces from the first task and goal lists.
  useEffect(() => {
    let live = true;
    void Promise.all([
      import("../a2ui/renderer"),
      import("@clock-compass/assistant-catalog"),
      import("@clock-compass/assistant-catalog/fixtures"),
      queryClient.fetchQuery(tasksQuery).catch((): Task[] => []),
      queryClient.fetchQuery(goalsQuery).catch((): Goal[] => []),
    ]).then(([renderer, catalog, fixtures, tasks, goals]) => {
      if (!live) return;
      const processor = renderer.createProcessor((action) =>
        setSent((s) => [...s, { action, parsed: catalog.parseAction(action) }]),
      );
      const rocks = pickRocks(tasks);
      const bars = goals.map((g) => ({ label: g.title, value: g.progress.done }));
      const all = {
        week_plan: fixtures.weekPlan(rocks, thisMonday()),
        schedule: rocks[0] ? fixtures.scheduleProposal(rocks[0], tomorrow()) : [],
        matrix: fixtures.matrixView(),
        goals_review: fixtures.goalsReview(undefined, bars.length ? bars : [{ label: "No goals", value: 0 }]),
        habits: fixtures.habitCheckIn(),
      };
      for (const [id, messages] of Object.entries(all)) {
        if (!only || only === id) renderer.processMessages(processor, messages);
      }
      setSurface({ renderer, processor });
    });
    return () => {
      live = false;
    };
  }, [only]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-lg">A2UI preview</h1>
        <Button size="sm" variant="outline" onClick={() => setDark((d) => !d)}>
          {dark ? "Light" : "Dark"}
        </Button>
      </header>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="rounded-xl border border-border bg-card p-4" data-testid="assistant-surface">
        {surface ? (
          <surface.renderer.A2uiSurfaces processor={surface.processor} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </div>
      <section aria-label="Sent actions" className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sent actions (parsed, not applied)
        </h2>
        {sent.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          sent.map((s, i) => (
            <pre
              key={i}
              data-testid="sent-action"
              className="overflow-x-auto rounded-md border border-border bg-muted p-2 text-[0.6875rem]"
            >
              {JSON.stringify(s, null, 2)}
            </pre>
          ))
        )}
      </section>
      <Toaster />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
