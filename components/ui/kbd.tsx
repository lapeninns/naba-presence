import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A keyboard hint. `kbd` rather than a styled span so a screen reader
 * announces it as a key, and so copied text keeps its meaning.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-(--np-radius-tag) border border-line bg-surface-sunken px-1 font-sans text-caption font-medium text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
