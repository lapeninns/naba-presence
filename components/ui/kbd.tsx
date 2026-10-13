import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A keyboard hint. `kbd` so a screen reader announces it as a key.
 *
 * `keycap` (reference `.kbd`): a 20px mono key on the surface with a hairline
 * edge and a 2px bottom edge. `plain` is bare muted text for a menu's
 * shortcut column.
 *
 * Hidden on touch: a shortcut is meaningless without a keyboard, and on a
 * phone it only spends width. It shows under `desk` (a fine pointer and
 * 48rem), where a keyboard is all but certain. Being `display: none`, it
 * also leaves the accessible name of a control it sits in. Pass
 * `touch="show"` for the rare hint that is the content itself (a
 * shortcuts reference page).
 */
function Kbd({
  className,
  variant = "keycap",
  touch = "hide",
  ...props
}: React.ComponentProps<"kbd"> & {
  variant?: "keycap" | "plain"
  touch?: "hide" | "show"
}) {
  return (
    <kbd
      data-slot="kbd"
      data-variant={variant}
      className={cn(
        "h-5 min-w-5 items-center justify-center font-mono text-caption text-ink-muted tabular-nums",
        touch === "hide" ? "hidden desk:inline-flex" : "inline-flex",
        variant === "keycap" &&
          "rounded-sm border border-b-2 border-line bg-surface px-1",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
