import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/stores/store";
import { themeStore, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Follow the device", icon: Monitor },
];

/** Settings · Appearance (#95): applied at once and kept on this device. */
export function ThemeSetting() {
  const { choice } = useStore(themeStore);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <span id="theme-label" className="text-sm font-medium">
        Appearance
      </span>
      <div
        role="group"
        aria-labelledby="theme-label"
        className="grid grid-cols-3 gap-1.5"
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const on = choice === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => themeStore.choose(value)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Kept on this device. “Follow the device” switches with your phone or
        computer.
      </p>
    </div>
  );
}
