"use client"

import * as React from "react"

import { formatDateTime, formatRelativeTime } from "@/lib/format"
import { readClock, subscribeClock } from "@/lib/time/clock"

/** Whether this render is hydrating server HTML (or is on the server). */
function subscribeNever() {
  return () => {}
}
const hydrated = () => true
const serverRendered = () => false

/**
 * A relative time ("4 minutes ago", "Just now") that hydrates cleanly.
 *
 * A relative time read during render is a different string on the server
 * and in the browser once a minute boundary falls between the two, and
 * React rejects the page ("the server rendered text didn't match"). So the
 * server and the hydrating client each say what they see, the mismatch on
 * this one text node is expected (`suppressHydrationWarning`), and straight
 * after hydration the element remounts on the shared clock, which replaces
 * the server's words with the browser's. A render that is not hydrating
 * (client navigation, tests) reads the clock at once.
 *
 * It is a `<time>` with the instant in `dateTime` and the absolute time in
 * `title`, so the exact moment is a hover away and machine-readable.
 * `prefix` and `suffix` join the relative words in ONE text node ("Last run
 * 16 minutes ago"), so the sentence reads and matches as a whole.
 * `casing`: `sentence` capitalises it to open a line; `mid-sentence` lowers
 * "Just now" for "checked just now". `within` limits the gap to an age
 * window and says `otherwise` (a date) outside it, the way a mail list
 * dates today's rows by gap and older ones by day; the switch reads the same
 * clock, so it hydrates as cleanly. `as="span"` is for a time already inside
 * a `<time>` that carries the instant.
 */
function RelativeTime({
  iso,
  prefix = "",
  suffix = "",
  casing = "as-is",
  within,
  timeZone = "Europe/London",
  as = "time",
  ...props
}: Omit<React.ComponentProps<"time">, "children" | "dateTime"> & {
  iso: string
  prefix?: string
  suffix?: string
  casing?: "as-is" | "sentence" | "mid-sentence"
  /** Relative only while the age is in [0, `ms`); `otherwise` past it. */
  within?: { ms: number; otherwise: string }
  /** The zone the absolute time in `title` is written in. */
  timeZone?: string
  as?: "time" | "span"
}) {
  const now = React.useSyncExternalStore(subscribeClock, readClock, readClock)
  const live = React.useSyncExternalStore(
    subscribeNever,
    hydrated,
    serverRendered
  )
  const at = new Date(iso).getTime()
  const age = now - at
  const words =
    within && !(age >= 0 && age < within.ms)
      ? within.otherwise
      : applyCasing(formatRelativeTime(iso, new Date(now)), casing)
  const Element = as
  return (
    <Element
      key={live ? "client" : "server"}
      data-slot="relative-time"
      dateTime={as === "time" ? iso : undefined}
      title={
        as === "time" && Number.isFinite(at)
          ? formatDateTime(iso, timeZone)
          : undefined
      }
      suppressHydrationWarning
      {...props}
    >
      {prefix + words + suffix}
    </Element>
  )
}

function applyCasing(
  text: string,
  casing: "as-is" | "sentence" | "mid-sentence"
): string {
  if (casing === "sentence" && text)
    return text[0]!.toUpperCase() + text.slice(1)
  if (casing === "mid-sentence" && text === "Just now") return "just now"
  return text
}

export { RelativeTime }
