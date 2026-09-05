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
 *
 * The pill is tinted (ink on tint, measured at 4.5:1); the dot is the vivid
 * solid step, so it stays legible at 6–8px.
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
        className={cn(
          "inline-flex size-2 shrink-0 rounded-(--np-radius-pill)",
          classes.dot,
          className
        )}
        {...props}
      />
    )
  }

  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      data-variant={variant}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 text-caption font-medium whitespace-nowrap tabular-nums",
        variant === "pill" &&
          cn(
            "h-(--np-pill-h) rounded-(--np-radius-pill) pr-2 pl-1.5",
            classes.tint,
            classes.text
          ),
        variant === "inline" && cn("text-ui", classes.text),
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-(--np-radius-pill)",
          classes.dot
        )}
        aria-hidden
      />
      {children}
    </span>
  )
}

export { StatusPill, type StatusPillProps }
