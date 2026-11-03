import * as React from "react"

import { StatusGlyph } from "@/components/ui/status-glyph"
import {
  describeOutcome,
  statusText,
  type PresentedState,
} from "@/lib/editors/outcome"
import {
  type StatusTone,
  type ToneAlias,
  type ToneName,
  toneClasses,
} from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

/**
 * Which of the three small labels to use:
 *
 * - `StatusPill` (this file) says what STATE something is in: a word plus a
 *   tone ("Verified", "Needs reply", "Paused"). Dot plus word, never colour
 *   alone. Its tones come from lib/ui/status-tone.ts and nowhere else.
 * - `Badge` (badge.tsx) is METADATA: a count, a role, a category ("OWNER",
 *   "You", "3 new"). Not interactive, and it does not claim a state; if the
 *   word would change when something happens, it is a StatusPill.
 * - `Chip` (chip.tsx: FilterChip, RemovableChip) is a CONTROL: a
 *   filter you press or a token you remove, with a 44px target on touch.
 *
 * Reference pill vocabulary: `ok/warn/bad/info` (and the intent names
 * `success/warning/danger`) are accepted aliases that resolve to the five
 * tones, so they can never take a colour of their own. `accent` (a draft or
 * preferred mark, the accent tint) and `outline` (a hairline-ringed
 * "not applicable") are the two presentation extras that are not states.
 */
export type PillTone = ToneAlias | "accent" | "outline"

type StatusPillProps = React.ComponentProps<"span"> & {
  /**
   * A change's lifecycle state (lib/editors/outcome.ts). It sets the tone,
   * draws the state's glyph in place of the dot and, without children, the
   * state's label ("Sent, waiting for Google"). Prefer it for anything that
   * can reach Google, so the words and the tone cannot drift apart.
   */
  state?: PresentedState
  /** Fills the state label's `{n}`, `{time}` and `{name}` slots. */
  values?: Parameters<typeof statusText>[1]
  /** Required unless `state` is given, which supplies it. */
  tone?: StatusTone | PillTone
  /**
   * `pill` is the default. `dot` renders the indicator alone for dense rows
   * and needs the state in nearby text (or `label`); `inline` is a dot plus
   * a label with no background, for a table cell where a filled pill would
   * be noise.
   */
  variant?: "pill" | "dot" | "inline"
  /**
   * A dashed ring instead of a filled dot: "not yet", "not set up", "no
   * reply yet" (reference `.pill.pending` / `.dot.pending`).
   */
  dashed?: boolean
  /** No dot at all (reference `.pill.plain`). */
  plain?: boolean
  /**
   * The state in words for `variant="dot"`, read by screen readers only.
   * Leave it off when the same words sit right beside the dot.
   */
  label?: string
}

const EXTRA_TONE = {
  accent: {
    text: "text-accent-ink",
    tint: "bg-accent-tint",
    dot: "bg-accent-solid",
  },
  outline: {
    text: "text-ink-secondary",
    tint: "bg-transparent inset-ring inset-ring-line",
    dot: "bg-ink-muted",
  },
} as const

function pillClasses(tone: StatusTone | PillTone) {
  return tone === "accent" || tone === "outline"
    ? EXTRA_TONE[tone]
    : toneClasses(tone as ToneName)
}

/**
 * One state indicator for the whole product (reference `.pill`): a pill
 * `--np-pill-h` tall (24px on touch, 22px on a desk) with a dot and the
 * state as a word, ink on its tint. Given a lifecycle `state`, the dot is
 * the state's glyph, so a state never relies on hue.
 *
 * Colour is never the only signal: `pill` and `inline` always carry a label,
 * and `dot` takes `label` or needs the state in adjacent text.
 *
 * The pill is at least `--np-pill-h` tall rather than exactly, and may wrap
 * inside a cell narrower than its word: a fixed-height, unshrinkable pill is
 * what ran under the neighbouring value in the old 360px table cards.
 */
function StatusPill({
  state,
  values,
  tone: toneProp,
  variant = "pill",
  dashed = false,
  plain = false,
  label,
  className,
  children,
  ...props
}: StatusPillProps) {
  const presentation = state ? describeOutcome(state) : null
  const tone = presentation?.tone ?? toneProp ?? "neutral"
  const classes = pillClasses(tone)
  const words =
    children ??
    (presentation ? statusText(presentation.label, values) : undefined)

  if (variant === "dot") {
    return (
      <span
        data-slot="status-pill"
        data-tone={tone}
        data-state={state}
        data-variant="dot"
        className={cn(
          "inline-block size-2 shrink-0 rounded-(--np-radius-pill)",
          dashed
            ? "border-[1.5px] border-dashed border-ink-muted bg-transparent"
            : classes.dot,
          className
        )}
        {...props}
      >
        {(label ?? (state ? words : null)) ? (
          <span className="sr-only">{label ?? words}</span>
        ) : null}
      </span>
    )
  }

  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      data-state={state}
      data-variant={variant}
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1.5 font-semibold tabular-nums",
        variant === "pill" &&
          cn(
            "min-h-(--np-pill-h) rounded-(--np-radius-pill) px-2 py-0.5 text-caption",
            classes.tint,
            classes.text
          ),
        variant === "inline" && cn("text-ui font-medium", classes.text),
        className
      )}
      {...props}
    >
      {plain ? null : presentation ? (
        <StatusGlyph
          glyph={presentation.glyph}
          className={cn(
            "size-3.5",
            variant === "inline" ? classes.text : "text-current"
          )}
        />
      ) : (
        <span
          className={cn(
            "shrink-0 rounded-(--np-radius-pill)",
            dashed
              ? "size-2 border-[1.5px] border-dashed border-current"
              : cn(
                  "size-1.5",
                  variant === "inline" ? classes.dot : "bg-current"
                )
          )}
          aria-hidden
        />
      )}
      {words}
    </span>
  )
}

export { StatusPill, type StatusPillProps }
