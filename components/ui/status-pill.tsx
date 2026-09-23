import * as React from "react"

import { TONE_CLASSES, type StatusTone } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

/**
 * The reference pill vocabulary (np.css `.pill.ok/.warn/.bad/.info/.accent/
 * .outline`), accepted alongside the product's five `StatusTone`s so a
 * caller can say what the reference says without a mapping table.
 */
export type PillTone = "ok" | "warn" | "bad" | "info" | "accent" | "outline"

type StatusPillProps = React.ComponentProps<"span"> & {
  tone: StatusTone | PillTone
  /**
   * `pill` is the default. `dot` renders the indicator alone for dense rows
   * and needs the state in nearby text; `inline` is a dot plus a label with no
   * background, for a table cell where a filled pill would be noise.
   */
  variant?: "pill" | "dot" | "inline"
  /**
   * A dashed ring instead of a filled dot: "not yet", "not set up", "no
   * reply yet" (reference `.pill.pending` / `.dot.pending`).
   */
  dashed?: boolean
  /** No dot at all (reference `.pill.plain`). */
  plain?: boolean
}

const PILL_TONE: Record<
  StatusTone | PillTone,
  { text: string; tint: string; dot: string }
> = {
  ...TONE_CLASSES,
  neutral: { text: "text-ink-secondary", tint: "bg-fill", dot: "bg-ink-muted" },
  ok: TONE_CLASSES.healthy,
  warn: TONE_CLASSES.attention,
  bad: TONE_CLASSES["at-risk"],
  info: TONE_CLASSES.pending,
  accent: {
    text: "text-accent-ink",
    tint: "bg-accent-tint",
    dot: "bg-primary",
  },
  outline: {
    text: "text-ink-secondary",
    tint: "bg-transparent shadow-[inset_0_0_0_1px_var(--np-line)]",
    dot: "bg-ink-muted",
  },
}

/**
 * One state indicator for the whole product (reference `.pill`): a 22px tag
 * with a 6px dot and the state as a word, ink on its tint.
 *
 * Colour is never the only signal: `pill` and `inline` always carry a label,
 * and `dot` is documented as needing the state in adjacent text.
 */
function StatusPill({
  tone,
  variant = "pill",
  dashed = false,
  plain = false,
  className,
  children,
  ...props
}: StatusPillProps) {
  const classes = PILL_TONE[tone]

  if (variant === "dot") {
    return (
      <span
        data-slot="status-pill"
        data-tone={tone}
        className={cn(
          "inline-block size-2 shrink-0 rounded-(--np-radius-pill)",
          dashed
            ? "border-[1.5px] border-dashed border-ink-muted bg-transparent"
            : classes.dot,
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
        "inline-flex w-fit shrink-0 items-center gap-1.5 leading-none font-semibold whitespace-nowrap tabular-nums",
        variant === "pill" &&
          cn(
            "h-[22px] rounded-(--np-radius-tag) px-2 text-caption",
            classes.tint,
            classes.text
          ),
        variant === "inline" && cn("text-ui font-medium", classes.text),
        className
      )}
      {...props}
    >
      {plain ? null : (
        <span
          className={cn(
            "shrink-0 rounded-(--np-radius-pill)",
            dashed
              ? "size-[7px] border-[1.5px] border-dashed border-current"
              : cn(
                  "size-1.5",
                  variant === "inline" ? classes.dot : "bg-current"
                )
          )}
          aria-hidden
        />
      )}
      {children}
    </span>
  )
}

export { StatusPill, type StatusPillProps }
