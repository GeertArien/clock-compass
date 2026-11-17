import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Settings } from "lucide-react";
import { getHealth } from "@clock-compass/web-client/api";
import { useStore } from "@/lib/stores/store";
import { modeItem, navStore, subItem } from "@/lib/stores/nav";
import { ModeSwitch } from "@/components/ModeSwitch";
import { SubTabs } from "@/components/SubTabs";
import { BottomNav } from "@/components/BottomNav";
import { PendingPanel } from "@/components/PendingPanel";
import { SettingsSheet, type Health } from "@/components/SettingsSheet";
import { Toaster } from "@/components/ui/toaster";

export function App() {
  const nav = useStore(navStore);
  const mode = modeItem(nav);
  const sub = subItem(nav);
  const [health, setHealth] = useState<Health>("checking");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Bumped on every open so the sheet remounts and re-reads the stored token,
  // while staying mounted on close so its exit animation can play.
  const [settingsKey, setSettingsKey] = useState(0);

  function openSettings() {
    setSettingsKey((k) => k + 1);
    setSettingsOpen(true);
  }

  const loadAll = useCallback(() => {
    getHealth()
      .then(() => setHealth("ok"))
      .catch(() => setHealth("down"));
  }, []);

  useEffect(loadAll, [loadAll]);

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
                className="relative size-8 rounded-full border-[1.5px] border-foreground"
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
              onClick={openSettings}
              aria-label="Settings"
              title="Settings"
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
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

          <PendingPanel key={`${nav.mode}.${sub.id}`} label={sub.label} />
        </main>

        <BottomNav />
      </div>

      <Toaster />
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
