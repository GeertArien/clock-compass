import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * The app's sheet layout, composed from the shadcn/ui Sheet: a bottom sheet on
 * phones, a centered dialog on desktop — the same shape as apps/web's Sheet.
 */
export function AppSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "max-h-[90dvh] gap-0 rounded-t-2xl border-0 bg-card",
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85dvh] sm:w-[30rem] sm:max-w-[calc(100vw-3rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          "sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95",
        )}
      >
        <SheetHeader className="gap-0.5 border-b pr-10">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-xs">{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <SheetFooter className="mt-0 border-t">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}
