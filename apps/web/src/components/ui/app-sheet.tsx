import type { ReactNode } from "react";
import { useHistoryLayer } from "@/lib/use-history-layer";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * The app's sheet layout, composed from the shadcn/ui Sheet: a bottom sheet on
 * phones, a centered dialog on desktop.
 */
export function AppSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  wide = false,
  fill = false,
  onBack,
  layerKey,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  /** A wider dialog on desktop, for content laid out in columns (the assistant's screens). */
  wide?: boolean;
  /**
   * One fixed height on desktop, the content laying out its own scrolling
   * (Settings: the section list beside a section that scrolls inside).
   */
  fill?: boolean;
  /** What the back gesture does (default: close). */
  onBack?: () => void;
  /** A new value puts the sheet's history layer back (see useHistoryLayer). */
  layerKey?: number;
  children?: ReactNode;
}) {
  // Back closes the sheet rather than the screen behind it.
  useHistoryLayer(open, () => (onBack ? onBack() : onOpenChange(false)), layerKey);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={cn(
          "max-h-[90dvh] gap-0 rounded-t-2xl border-0 bg-card",
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85dvh] sm:max-w-[calc(100vw-3rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          wide ? "sm:w-[46rem]" : "sm:w-[30rem]",
          fill && "sm:h-[min(85dvh,44rem)]",
          "sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95",
        )}
      >
        {/* Header: title and description beside a padded close button. */}
        <SheetHeader className="flex-row items-start justify-between gap-2 border-b">
          <div className="flex flex-col gap-0.5">
            <SheetTitle className="text-base">{title}</SheetTitle>
            {description ? (
              <SheetDescription className="text-xs">{description}</SheetDescription>
            ) : null}
          </div>
          <SheetClose
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" />
          </SheetClose>
        </SheetHeader>
        <div className={cn("flex-1", fill ? "min-h-0 overflow-y-auto p-4 sm:overflow-hidden sm:p-0" : "overflow-y-auto p-4")}>
          {children}
        </div>
        {footer ? <SheetFooter className="mt-0 border-t">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
