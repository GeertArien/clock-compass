import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Matches apps/web's input: text-sm at every width (upstream uses text-base
        // below md), the border token, shadow-sm, the 2px focus ring, and no
        // dark: overrides (the tokens already switch with the theme).
        "h-9 w-full min-w-0 rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    />
  )
}

export { Input }
