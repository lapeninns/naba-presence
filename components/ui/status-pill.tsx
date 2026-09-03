import * as React from "react"

import { TONE_CLASSES, type StatusTone } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

type StatusPillProps = React.ComponentProps<"span"> & {
  tone: StatusTone
  /**
   * `pill` is the default. `dot` renders the indicator alone for dense rows
   * and needs the state in nearby text; `inline` is a dot plus a label with no
   * background, for a table cell where a filled pill would be noise.
   */
  variant?: "pill" | "dot" | "inline"
}

/**
 * One state indicator for the whole product.
 *
 * Colour is never the only signal: `pill` and `inline` always carry a label,
 * and `dot` is documented as needing the state in adjacent text. A viewer who
 * cannot distinguish the hues still reads the word.
 */
function StatusPill({
  tone,
  variant = "pill",
  className,
  children,
  ...props
}: StatusPillProps) {
  const classes = TONE_CLASSES[tone]

  if (variant === "dot") {
    return (
      <span
        data-slot="status-pill"
        data-tone={tone}
        className={cn("inline-flex size-2 shrink-0 rounded-full", classes.dot, className)}
        {...props}
      />
    )
  }

  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap text-caption font-medium",
        variant === "pill" &&
          cn("h-(--np-pill-h) rounded-(--np-radius-pill) px-2", classes.tint, classes.text),
        variant === "inline" && classes.text,
        className
      )}
      {...props}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", classes.dot)} aria-hidden />
      {children}
    </span>
  )
}

export { StatusPill, type StatusPillProps }
