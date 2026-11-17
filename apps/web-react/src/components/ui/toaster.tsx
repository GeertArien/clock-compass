import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/stores/store";
import { toast, type ToastKind } from "@/lib/stores/toast";

const icons = { success: CheckCircle2, error: XCircle, info: Info };

function accent(kind: ToastKind): string {
  return kind === "success"
    ? "text-emerald-600"
    : kind === "error"
      ? "text-red-600"
      : "text-muted-foreground";
}

/** Bottom-center on mobile (above the bottom nav), bottom-right on desktop. */
export function Toaster() {
  const { items } = useStore(toast);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:items-end"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-in fade-in-0 slide-in-from-bottom-4 items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm shadow-lg duration-200"
            role="status"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", accent(t.kind))} />
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => toast.dismiss(t.id)}
              aria-label="Dismiss"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
