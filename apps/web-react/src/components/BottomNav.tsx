import { cn } from "@/lib/utils";
import { useStore } from "@/lib/stores/store";
import { MODES, navStore } from "@/lib/stores/nav";
import { MODE_ICONS } from "./mode-icons";

/** Mobile-only fixed bottom navigation: the three modes (thumb-reachable). */
export function BottomNav() {
  const mode = useStore(navStore, (s) => s.mode);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {MODES.map((item) => {
        const Icon = MODE_ICONS[item.id];
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => navStore.go(item.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[0.6875rem] font-semibold transition-colors",
              !active && "text-muted-foreground",
            )}
            style={active ? { color: item.accent } : undefined}
          >
            <Icon className="size-5" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
