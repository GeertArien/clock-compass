/**
 * Dev-only preview of the assistant's A2UI renderer (issue #62, step 1):
 * hand-written A2UI 1.0 rendered through the official React renderer with the
 * app's own components, reading real tasks from the server through the query
 * modules. Open /a2ui-preview.html on the Vite dev server; `?theme=dark`
 * starts in dark mode. The renderer is loaded with `import()`, as the
 * assistant sheet will load it.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Task } from "@clock-compass/web-client/api";
import { queryClient } from "@/lib/query-client";
import { tasksQuery, useTasksQuery } from "@/lib/queries/tasks";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import "../../app.css";

type Renderer = typeof import("../a2ui/renderer");

/** ISO week label, e.g. "2026-W47". */
function isoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Up to three open tasks, big rocks and Q2 first: what a week plan would propose. */
function pickRocks(tasks: Task[]): string[] {
  const open = tasks.filter((t) => t.status !== "DONE");
  const rank = (t: Task) => (t.isBigRock ? 0 : t.quadrant === "Q2" ? 1 : 2);
  return [...open].sort((a, b) => rank(a) - rank(b)).slice(0, 3).map((t) => t.id);
}

function Preview() {
  const [dark, setDark] = useState(() => new URLSearchParams(location.search).get("theme") === "dark");
  const [surface, setSurface] = useState<{
    renderer: Renderer;
    processor: ReturnType<Renderer["createProcessor"]>;
  } | null>(null);
  const [actions, setActions] = useState<unknown[]>([]);
  const { error } = useTasksQuery();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.body.style.background = "var(--background)";
    document.body.style.color = "var(--foreground)";
  }, [dark]);

  // Load the renderer as the assistant sheet will (import()), then build the
  // surface from the first task list.
  useEffect(() => {
    let live = true;
    void Promise.all([
      import("../a2ui/renderer"),
      import("../a2ui/fixtures"),
      queryClient.fetchQuery(tasksQuery).catch((): Task[] => []),
    ]).then(([renderer, fixtures, tasks]) => {
      if (!live) return;
      const processor = renderer.createProcessor((action) => setActions((a) => [...a, action]));
      renderer.processMessages(processor, fixtures.weekPlan(pickRocks(tasks), isoWeek()));
      setSurface({ renderer, processor });
    });
    return () => {
      live = false;
    };
  }, []);

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
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sent actions</h2>
        {actions.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet.</p>
        ) : (
          actions.map((a, i) => (
            <pre key={i} data-testid="sent-action" className="overflow-x-auto rounded-md border border-border bg-muted p-2 text-[0.6875rem]">
              {JSON.stringify(a, null, 2)}
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
