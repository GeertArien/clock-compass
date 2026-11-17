import type { ComponentType, ReactNode } from "react";

/** Dashed placeholder for an empty list (mirrors apps/web's EmptyState). */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
      {Icon ? <Icon className="size-6 text-muted-foreground" /> : null}
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
