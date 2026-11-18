import { cn } from "@/lib/utils";
import { useStore } from "@/lib/stores/store";
import { SUBS, navStore } from "@/lib/stores/nav";

/** Quiet underline tabs within the active mode; hidden when there's one screen. */
export function SubTabs() {
  const nav = useStore(navStore);
  const subs = SUBS[nav.mode];
  if (subs.length <= 1) return null;
  return (
    <nav className="-mb-px flex gap-0.5 overflow-x-auto border-b border-border" aria-label="Sections">
      {subs.map((sub) => {
        const active = nav.sub === sub.id;
        return (
          <button
            key={sub.id}
            type="button"
            onClick={() => navStore.goSub(sub.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 px-3.5 py-2.5 text-[0.8125rem] whitespace-nowrap transition-colors",
              active
                ? "font-semibold"
                : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
            style={active ? { color: "var(--mode)", borderColor: "var(--mode)" } : undefined}
          >
            {sub.label}
          </button>
        );
      })}
    </nav>
  );
}
