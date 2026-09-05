import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A keyboard hint. `kbd` rather than a styled span so a screen reader
 * announces it as a key, and so copied text keeps its meaning.
 *
 * `keycap` (the default) is a small key on the fill ladder with a hairline
 * edge, for hints in empty states, tooltips and the command palette footer.
 * `plain` is bare muted text, for the shortcut column of a menu, where the
 * platform draws no keycaps.
 */
function Kbd({
  className,
  variant = "keycap",
  ...props
}: React.ComponentProps<"kbd"> & { variant?: "keycap" | "plain" }) {
  return (
    <kbd
      data-slot="kbd"
      data-variant={variant}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center font-sans text-caption font-medium text-ink-muted tabular-nums",
        variant === "keycap" &&
          "rounded-(--np-radius-tag) bg-fill-secondary px-1.5 hairline",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
