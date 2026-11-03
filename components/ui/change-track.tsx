import {
  BadgeCheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CircleMinusIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import * as React from "react"

import {
  describeOutcome,
  statusText,
  TRACK_STOPS,
  type PresentedState,
  type TrackStop,
} from "@/lib/editors/outcome"
import { cn } from "@/lib/utils"

export type ChangeTrackStopState =
  "done" | "current" | "todo" | "failed" | "skipped" | "reached"

/** The words of each stop, in track order (DIRECTION §6.1). */
export const TRACK_STOP_LABEL: Record<TrackStop, string> = {
  saved: "Saved here",
  approved: "Approved",
  sent: "Sent",
  google: "On Google",
}

/** A skipped approval says so; it is never silently ticked. */
export const SKIPPED_STOP_LABEL = "Not needed"

/**
 * The spoken state of each stop, after its label ("Sent, not sent yet").
 * A failed stop's label is already the state's own words, and a skipped
 * stop's is "Not needed", so those two add nothing.
 */
const STOP_WORD: Record<ChangeTrackStopState, string | null> = {
  done: "done",
  current: "current step",
  todo: "not sent yet",
  failed: null,
  skipped: null,
  reached: "done",
}

const STOP_GLYPH: Record<ChangeTrackStopState, LucideIcon> = {
  done: CircleCheckIcon,
  current: CircleDotIcon,
  todo: CircleIcon,
  failed: TriangleAlertIcon,
  skipped: CircleMinusIcon,
  reached: BadgeCheckIcon,
}

/**
 * Stop tones (SYSTEM §10): done is an ink-secondary tick, current the ink
 * dot, to-do a muted ring (ink-muted, not decorative: `compact` hides the
 * labels and is not always beside a status pill, so the ring must read on
 * its own), failed the danger triangle, skipped a muted minus, and the reached
 * On Google stop the only green on the track.
 */
const STOP_GLYPH_TONE: Record<ChangeTrackStopState, string> = {
  done: "text-ink-secondary",
  current: "text-ink",
  todo: "text-ink-muted",
  failed: "text-danger-ink",
  skipped: "text-ink-muted",
  reached: "text-success-ink",
}

const STOP_LABEL_TONE: Record<ChangeTrackStopState, string> = {
  done: "text-ink-secondary",
  current: "font-semibold text-ink",
  todo: "text-ink-muted",
  failed: "font-semibold text-danger-ink",
  skipped: "text-ink-muted",
  reached: "font-semibold text-success-ink",
}

export type ChangeTrackStop = {
  stop: TrackStop
  state: ChangeTrackStopState
  label: string
}

/**
 * Where a state sits on the four stops, in order. `null` for a state that
 * is not a step towards Google (unsaved, conflict, withdrawn…).
 *
 * Earlier stops are done, the state's own stop is current (or failed, with
 * the state's pill label in place of the stop's), later stops are to do.
 * Every stop of a confirmed change is done and On Google is reached. With
 * `approval: "skipped"` an Approved stop that is behind the change reads
 * "Not needed" instead of a tick.
 */
export function trackStops(
  state: PresentedState,
  {
    approval = "needed",
    values,
  }: {
    approval?: "needed" | "skipped"
    values?: Parameters<typeof statusText>[1]
  } = {}
): ChangeTrackStop[] | null {
  const presentation = describeOutcome(state)
  const position = presentation.track
  if (!position) return null
  const at = TRACK_STOPS.indexOf(position.stop)
  return TRACK_STOPS.map((stop, index) => {
    let stopState: ChangeTrackStopState =
      index < at
        ? "done"
        : index > at
          ? "todo"
          : position.reached
            ? "reached"
            : position.failed
              ? "failed"
              : "current"
    if (stop === "approved" && approval === "skipped" && index < at)
      stopState = "skipped"
    const label =
      stopState === "failed"
        ? statusText(presentation.label, values)
        : stopState === "skipped"
          ? SKIPPED_STOP_LABEL
          : TRACK_STOP_LABEL[stop]
    return { stop, state: stopState, label }
  })
}

/**
 * The change track (DIRECTION §1.1 principle 2): the four stops every change
 * bound for Google passes, *Saved here → Approved → Sent → On Google*, drawn
 * from the change's lifecycle state in lib/editors/outcome.ts, so a track
 * can never disagree with the pill or the dispatch bar beside it.
 *
 * `compact` drops the visible labels for a table cell; the stops are still
 * spoken. Without `aria-label` the list is named "Where this change is".
 * A state that is not a Google step renders nothing.
 *
 * The connector after a done stop is ink-secondary, after any other a quiet
 * line. A stop advances with a 140ms colour transition only.
 */
function ChangeTrack({
  state,
  approval,
  values,
  compact = false,
  className,
  "aria-label": ariaLabel = "Where this change is",
  ...props
}: Omit<React.ComponentProps<"ol">, "children"> & {
  state: PresentedState
  /** "skipped" when the change needed no approval. */
  approval?: "needed" | "skipped"
  /** Fills a failed stop's `{time}` / `{name}` slots. */
  values?: Parameters<typeof statusText>[1]
  compact?: boolean
}) {
  const stops = trackStops(state, { approval, values })
  if (!stops) return null
  return (
    <ol
      data-slot="change-track"
      data-state={state}
      data-compact={compact || undefined}
      aria-label={ariaLabel}
      className={cn("flex min-w-0 list-none", compact && "w-fit", className)}
      {...props}
    >
      {stops.map((stop, index) => {
        const Glyph = STOP_GLYPH[stop.state]
        const isLast = index === stops.length - 1
        const word = STOP_WORD[stop.state]
        return (
          <li
            key={stop.stop}
            data-stop={stop.stop}
            data-state={stop.state}
            aria-current={
              stop.state === "current" || stop.state === "failed"
                ? "step"
                : undefined
            }
            className={cn(
              "relative flex min-w-0 flex-col gap-1",
              // Compact: a fixed step per stop (glyph plus a short connector),
              // the last stop the glyph alone.
              compact ? "w-8 last:w-4" : "flex-1 pr-2 last:flex-none"
            )}
          >
            <span aria-hidden className="flex items-center">
              <Glyph
                data-glyph={stop.state}
                strokeWidth={2}
                className={cn(
                  "size-4 shrink-0 transition-colors duration-(--np-duration-fast)",
                  STOP_GLYPH_TONE[stop.state]
                )}
              />
              {isLast ? null : (
                <span
                  data-slot="change-track-connector"
                  className={cn(
                    "mx-1 h-px grow transition-colors duration-(--np-duration-fast)",
                    stop.state === "done" ||
                      stop.state === "skipped" ||
                      stop.state === "reached"
                      ? "bg-ink-secondary"
                      : "bg-line"
                  )}
                />
              )}
            </span>
            <span
              className={cn(
                "text-caption transition-colors duration-(--np-duration-fast)",
                STOP_LABEL_TONE[stop.state],
                compact && "sr-only"
              )}
            >
              {stop.label}
              {word ? <span className="sr-only">, {word}</span> : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export { ChangeTrack }
