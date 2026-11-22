import { Suspense, lazy, useCallback, useEffect, useState, type CSSProperties } from "react";
import { Plus, Settings, Sparkles } from "lucide-react";
import { getHealth } from "@clock-compass/web-client/api";
import { useStore } from "@/lib/stores/store";
import { Navigate, useLocation } from "react-router";
import { modeItem, resolvePath, subItem, type Mode, type NavState, type Sub } from "@/lib/nav";
import { useScreenEffects } from "@/lib/use-nav";
import { ModeSwitch } from "@/components/ModeSwitch";
import { SubTabs } from "@/components/SubTabs";
import { BottomNav } from "@/components/BottomNav";
import { SettingsSheet, type Health } from "@/components/SettingsSheet";
import { TodayPanel } from "@/components/TodayPanel";
import { MissionPanel } from "@/components/MissionPanel";
import { GoalsPanel } from "@/components/GoalsPanel";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { QuadrantBoard } from "@/components/QuadrantBoard";
import { PeoplePanel } from "@/components/PeoplePanel";
import { RenewPanel } from "@/components/RenewPanel";
import { AlmanacPanel } from "@/components/AlmanacPanel";
import { WeekPanel } from "@/components/WeekPanel";
import { TaskFormSheet } from "@/components/TaskFormSheet";
import { CaptureSheet } from "@/components/CaptureSheet";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { taskWrites, tasksQuery } from "@/lib/queries/tasks";
import { queryClient } from "@/lib/query-client";
import { missionQuery } from "@/lib/queries/mission";
import { rolesQuery } from "@/lib/queries/roles";
import { peopleQuery } from "@/lib/queries/people";
import { goalsQuery } from "@/lib/queries/goals";
import { projectsQuery } from "@/lib/queries/projects";
import { habitsQuery, intentionsQuery, summaryQuery } from "@/lib/queries/renewal";
import { aiStatusQuery, useCodexPolling } from "@/lib/queries/ai";
import { taskActions } from "@/lib/stores/task-actions";
import { toast } from "@/lib/stores/toast";

/**
 * The assistant (issue #62) is its own chunk, loaded on first open: none of
 * it is in the first load. The service worker precaches it, so it opens
 * offline too (and says the assistant needs a connection).
 */
const AssistantSheet = lazy(() =>
  import("@/assistant/AssistantSheet").catch(() => {
    toast.error("The assistant could not be loaded. Check your connection and reload.");
    return { default: (() => null) as unknown as typeof import("@/assistant/AssistantSheet").default };
  }),
);

/** The screen for the active mode and sub-tab. */
function Screen({ mode, sub }: { mode: Mode; sub: Sub }) {
  if (mode === "clock") return sub === "week" ? <WeekPanel /> : <TodayPanel />;
  if (mode === "compass") {
    if (sub === "matrix") return <QuadrantBoard />;
    if (sub === "projects") return <ProjectsPanel />;
    if (sub === "people") return <PeoplePanel />;
    if (sub === "renew") return <RenewPanel />;
    return (
      <div className="flex flex-col gap-6">
        <MissionPanel />
        <GoalsPanel />
      </div>
    );
  }
  // Almanac: one panel for both sub-tabs, so it stays mounted between them.
  return <AlmanacPanel />;
}

/**
 * Resolves the URL to a screen. A bare mode, an unknown path and the legacy
 * `?go=` notification links redirect (replacing the entry, so back skips
 * them); a valid screen renders the app shell. The shell stays mounted across
 * screens, so the Almanac panel (and a generated review) survives switching.
 */
export function Root() {
  const { pathname, search } = useLocation();
  const resolved = resolvePath(pathname, search);
  if ("redirect" in resolved) return <Navigate to={resolved.redirect} replace />;
  return <App nav={resolved.screen} />;
}

function App({ nav }: { nav: NavState }) {
  useScreenEffects(nav);
  // A ChatGPT sign-in started in Settings keeps polling while it's closed.
  useCodexPolling();
  const mode = modeItem(nav);
  const sub = subItem(nav);
  const [health, setHealth] = useState<Health>("checking");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Bumped on every open so the sheet remounts and re-reads the stored token,
  // while staying mounted on close so its exit animation can play.
  const [settingsKey, setSettingsKey] = useState(0);

  const [assistantOpen, setAssistantOpen] = useState(false);
  // Mounted from the first open on, so its exit animation can play.
  const [assistantLoaded, setAssistantLoaded] = useState(false);
  const openAssistant = useCallback(() => {
    setAssistantLoaded(true);
    setAssistantOpen(true);
  }, []);

  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureKey, setCaptureKey] = useState(0);
  const actions = useStore(taskActions);

  function openSettings() {
    setSettingsKey((k) => k + 1);
    setSettingsOpen(true);
  }

  // Remount on every open so the sheet starts empty.
  const openCapture = useCallback(() => {
    setCaptureKey((k) => k + 1);
    setCaptureOpen(true);
  }, []);

  const loadAll = useCallback(() => {
    getHealth()
      .then(() => setHealth("ok"))
      .catch(() => setHealth("down"));
    // Server data in the query cache: refetch what's shown, and load the
    // mission up front as the stores load theirs.
    void queryClient.invalidateQueries();
    void queryClient.prefetchQuery(missionQuery);
    void queryClient.prefetchQuery(rolesQuery);
    void queryClient.prefetchQuery(peopleQuery);
    void queryClient.prefetchQuery(tasksQuery);
    void queryClient.prefetchQuery(goalsQuery);
    void queryClient.prefetchQuery(projectsQuery);
    void queryClient.prefetchQuery(habitsQuery);
    void queryClient.prefetchQuery(summaryQuery);
    void queryClient.prefetchQuery(intentionsQuery);
    void queryClient.prefetchQuery(aiStatusQuery);
  }, []);

  useEffect(loadAll, [loadAll]);

  // ⌘K / Ctrl+K opens capture from anywhere.
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openCapture();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [openCapture]);

  return (
    <>
      {/* The active mode's accent flows through kickers, tabs, and highlights. */}
      <div
        className="flex min-h-dvh flex-col"
        style={{ "--mode": mode.accent } as CSSProperties}
      >
        <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
            <div className="flex items-center gap-2.5">
              {/* The compass mark from the prototypes: ink ring; the needle wears the two
                  everyday modes — terracotta north (Clock), pine south (Compass). */}
              <div
                aria-hidden="true"
                className="relative size-8 shrink-0 rounded-full border-[1.5px] border-foreground"
              >
                <div className="absolute inset-0 m-auto h-[22px] w-[2px] rotate-[34deg] bg-[linear-gradient(var(--terra)_0_50%,var(--pine)_50%_100%)]" />
              </div>
              <h1 className="font-display text-lg font-semibold tracking-tight">
                Clock <span className="text-[var(--terra)] italic">&amp;</span> Compass
              </h1>
            </div>

            <div className="flex flex-1 justify-center">
              <ModeSwitch />
            </div>

            <button
              type="button"
              onClick={openAssistant}
              aria-label="Assistant"
              title="Assistant"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <Sparkles className="size-5" />
            </button>
            <button
              type="button"
              onClick={openCapture}
              aria-label="Capture"
              title="Capture (⌘K)"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <Plus className="size-5" />
            </button>
            <button
              type="button"
              onClick={openSettings}
              aria-label="Settings"
              title="Settings"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            >
              <Settings className="size-5" />
            </button>
          </div>
        </header>

        {/* Phones: pb-36 lets the last row scroll clear of the floating capture
            button (bottom-20 + size-13 = 132px) as well as the bottom nav. */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-36 sm:pb-10">
          {/* Page header: mode kicker + serif title for the active screen. */}
          <p
            className="text-[0.65625rem] font-semibold tracking-[0.24em] uppercase"
            style={{ color: "var(--mode)" }}
          >
            {mode.label}
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight">{sub.title}</h2>
          <p className="mt-1 mb-4 text-[0.8125rem] text-muted-foreground">{sub.subtitle}</p>

          <div className="mb-6">
            <SubTabs />
          </div>

          <Screen mode={nav.mode} sub={sub.id} />
        </main>

        {/* Mobile capture button, floating above the bottom nav. */}
        <button
          type="button"
          onClick={openCapture}
          aria-label="Capture"
          className="fixed right-4 bottom-20 z-40 flex size-13 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg active:scale-95 sm:hidden"
        >
          <Plus className="size-6" />
        </button>

        <BottomNav />
      </div>

      <Toaster />
      {assistantLoaded ? (
        <Suspense fallback={null}>
          <AssistantSheet
            open={assistantOpen}
            onOpenChange={setAssistantOpen}
            view={`${mode.label} · ${sub.title}`}
          />
        </Suspense>
      ) : null}
      <CaptureSheet key={`capture-${captureKey}`} open={captureOpen} onOpenChange={setCaptureOpen} />
      <TaskFormSheet
        key={`task-${actions.editSeq}`}
        open={actions.editOpen}
        onOpenChange={(open) => taskActions.setEditOpen(open)}
        task={actions.editing}
      />
      <ConfirmDialog
        open={actions.deleteOpen}
        onOpenChange={(open) => taskActions.setDeleteOpen(open)}
        title="Delete task?"
        description={actions.deleting ? `“${actions.deleting.title}” will be removed.` : ""}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (actions.deleting) void taskWrites.remove(actions.deleting);
        }}
      />
      <SettingsSheet
        key={settingsKey}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        health={health}
        onSaved={loadAll}
      />
    </>
  );
}
