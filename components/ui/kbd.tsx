import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A keyboard hint. `kbd` so a screen reader announces it as a key.
 *
 * `keycap` (reference `.kbd`): a 20px mono key on the surface with a hairline
 * edge and a 2px bottom edge. `plain` is bare muted text for a menu's
 * shortcut column.
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
        "inline-flex h-5 min-w-5 items-center justify-center font-mono text-[11px] text-ink-muted tabular-nums",
        variant === "keycap" &&
          "rounded-[5px] border border-b-2 border-line bg-surface px-[5px]",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
