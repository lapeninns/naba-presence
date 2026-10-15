"use client"

import { InfoIcon } from "lucide-react"
import { useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { PresenceResponse } from "@/lib/contracts/analytics"
import { formatDate, formatDateTime } from "@/lib/format"

const noSubscribe = () => () => {}

/**
 * False while rendering on the server and while hydrating, true after: the
 * one moment a component may read the viewer's own clock settings without
 * the first client render disagreeing with the server's HTML.
 */
function useHydrated() {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  )
}

/** "BST", "GMT+13", "UTC": the zone an instant is written in. */
export function zoneLabel(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return timeZone
  return (
    new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone
  )
}

/**
 * An instant written in a named zone, with the zone on screen ("13 Oct 2026,
 * 09:12 GMT+13") and the machine-readable instant in `dateTime`.
 *
 * Pass `timeZone` whenever the page has one (the organisation's): the text
 * is then the same on the server and in the browser. Without one it is the
 * viewer's own zone, which the server cannot know, so the server and the
 * hydrating client both write UTC and the browser switches to the viewer's
 * zone after mount. Either way there is no hydration mismatch.
 */
export function ZonedTime({
  iso,
  timeZone,
  className,
}: {
  iso: string
  timeZone?: string
  className?: string
}) {
  const hydrated = useHydrated()
  const zone =
    timeZone ??
    (hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC")
  return (
    <time dateTime={iso} className={className}>
      {`${formatDateTime(iso, zone)} ${zoneLabel(iso, zone)}`}
    </time>
  )
}

/**
 * Where a Google figure comes from: the last day Google has reported
 * (Google's own daily dates, never shifted into another zone), when we last
 * fetched successfully, and how many locations in scope are reporting.
 * "Data through" and "last fetched" are different facts: a fetch today can
 * still only carry data through last week.
 *
 * `timeZone` writes the fetch times in that zone (the public report passes
 * the organisation's); without it they are the viewer's, after hydration.
 */
export function PresenceProvenance({
  data,
  timeZone,
}: {
  data: PresenceResponse
  timeZone?: string
}) {
  const coverage = data.coverage
  const oldest = data.fetchedAt?.oldest ?? null
  const newest = data.fetchedAt?.newest ?? oldest
  const dataThrough = data.freshThrough
    ? `Data through ${formatDate(data.freshThrough, "UTC")} (Google’s daily dates)`
    : "No Google data in this window"
  // The oldest per-location watermark, when it trails the newest date: every
  // location is complete up to it, only some beyond it.
  const completeThrough = data.completeness?.completeThrough
  const completeLine =
    completeThrough && data.freshThrough && completeThrough < data.freshThrough
      ? `All reporting locations complete through ${formatDate(completeThrough, "UTC")}`
      : null
  const coverageParts = coverage
    ? [
        `${coverage.reporting} of ${coverage.eligible} ${coverage.eligible === 1 ? "location" : "locations"} reporting`,
        coverage.unavailable ? `${coverage.unavailable} unavailable` : null,
        coverage.stale ? `${coverage.stale} stale` : null,
        coverage.pending ? `${coverage.pending} not fetched yet` : null,
      ].filter((part): part is string => part !== null)
    : []
  return (
    <div className="flex flex-col gap-0.5 text-caption text-ink-muted">
      <p className="tabular-nums">
        {dataThrough}
        {completeLine ? ` · ${completeLine}` : null}
        {" · "}
        {oldest === null ? (
          "Not fetched successfully yet"
        ) : oldest === newest || newest === null ? (
          <>
            Last fetched <ZonedTime iso={oldest} timeZone={timeZone} />
          </>
        ) : (
          <>
            Last fetched between <ZonedTime iso={oldest} timeZone={timeZone} />{" "}
            and <ZonedTime iso={newest} timeZone={timeZone} />
          </>
        )}
      </p>
      {coverageParts.length ? (
        <p className="tabular-nums" data-slot="presence-coverage">
          {coverageParts.join(" · ")}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Provenance in one caption line ("Through 14 Oct · 1 of 2 locations") with
 * an info button whose sheet holds the detail ({@link PresenceProvenance}):
 * the last day Google has reported, when we last fetched and how many
 * locations are reporting. The two-line block it replaces took the first
 * figure of the report off a phone's first screen.
 */
export function PresenceCaption({
  data,
  timeZone,
}: {
  data: PresenceResponse
  timeZone?: string
}) {
  const coverage = data.coverage
  const through = data.freshThrough
    ? `Through ${formatDate(data.freshThrough, "UTC")}`
    : "No Google data in this window"
  const reporting = coverage
    ? `${coverage.reporting} of ${coverage.eligible} ${coverage.eligible === 1 ? "location" : "locations"}`
    : null
  return (
    <div
      data-slot="presence-caption"
      className="flex min-w-0 items-center gap-1 text-caption text-ink-muted"
    >
      <p className="min-w-0 tabular-nums">
        {through}
        {reporting ? ` · ${reporting}` : null}
      </p>
      <Sheet>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="About these figures"
              className="text-ink-muted"
            />
          }
        >
          <InfoIcon aria-hidden strokeWidth={1.75} />
        </SheetTrigger>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>About these figures</SheetTitle>
            <SheetDescription>
              Where the Google figures in this report come from.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <PresenceProvenance data={data} timeZone={timeZone} />
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  )
}
