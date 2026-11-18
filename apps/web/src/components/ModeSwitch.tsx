import { cn } from "@/lib/utils";
import { MODES } from "@/lib/nav";
import { useGo, useScreen } from "@/lib/use-nav";
import { MODE_ICONS } from "./mode-icons";

/** Desktop three-mode switch: Compass · Clock · Almanac. */
export function ModeSwitch() {
  const { mode } = useScreen();
  const go = useGo();
  return (
    <div
      className="hidden items-center gap-0.5 rounded-full border border-input bg-card p-0.5 sm:inline-flex"
      role="tablist"
      aria-label="Mode"
    >
      {MODES.map((item) => {
        const Icon = MODE_ICONS[item.id];
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            role="tab"
            aria-selected={active}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.8125rem] font-semibold transition-colors",
              active ? "text-white" : "text-muted-foreground hover:text-foreground",
            )}
            style={active ? { background: item.accent } : undefined}
          >
            <Icon className="size-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
