"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"

import { longDay, utcDay } from "@/components/calendar/calendar-dates"
import { Card } from "@/components/ui/card"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { StatusPill, type PillTone } from "@/components/ui/status-pill"
import type { StatusTone } from "@/lib/ui/status-tone"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { ScheduleOccurrence } from "@/lib/contracts/publication-schedules"
import { clockChangeNote } from "@/lib/domain/publication-schedule"
import { useHydratedBreakpoint } from "@/lib/hooks/use-media-query"
import { occurrenceReasonText } from "@/lib/locations/schedule-display"
import { cn } from "@/lib/utils"

const STATUS: Record<
  ScheduleOccurrence["status"],
  { label: string; tone: StatusTone | PillTone }
> = {
  scheduled: { label: "Scheduled", tone: "pending" },
  publishing: { label: "Publishing", tone: "pending" },
  published: { label: "Published", tone: "healthy" },
  rejected: { label: "Rejected", tone: "at-risk" },
  ambiguous: { label: "Outcome unknown", tone: "attention" },
  missed: { label: "Missed", tone: "attention" },
  cancelled: { label: "Cancelled", tone: "outline" },
}

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]
const countLabel = (count: number) =>
  `${count} ${count === 1 ? "publication" : "publications"}`

type ByDate = Map<string, ScheduleOccurrence[]>

/**
 * One publication. The full form is a 44px row (time and listing, then the
 * status word and summary); `compact` is the one-line form inside a wide
 * grid cell, with the status for screen readers only.
 */
function Entry({
  occurrence,
  compact,
}: {
  occurrence: ScheduleOccurrence
  compact?: boolean
}) {
  const status = STATUS[occurrence.status]
  return (
    <Link
      href={`/listings/${occurrence.locationId}/posts`}
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-(--np-radius-control) px-1.5 py-1 text-left focus-halo hover:bg-fill focus-visible:outline-none",
        !compact && "min-h-11 justify-center"
      )}
    >
      <span className="truncate text-caption font-semibold text-ink tabular-nums">
        {occurrence.localTime} {occurrence.locationName}
      </span>
      {compact ? (
        <span className="sr-only">
          {status.label}: {occurrence.summary}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-1 text-caption text-ink-muted">
          <StatusPill tone={status.tone} plain>
            {status.label}
          </StatusPill>
          <span className="truncate">
            {occurrence.summary || occurrence.topicType}
          </span>
        </span>
      )}
    </Link>
  )
}

/**
 * The listing's timezone, what a clock change did to this run and, for one
 * that did not publish, why (a missed run is never retried: P08-R5).
 */
function OccurrenceMeta({ occurrence }: { occurrence: ScheduleOccurrence }) {
  const note = clockChangeNote(occurrence.adjustment)
  const reason = occurrenceReasonText(occurrence)
  return (
    <span className="block px-1.5 text-caption text-ink-muted">
      {occurrence.timezone}
      {note ? ` · ${note}` : ""}
      {reason ? ` · ${reason}` : ""}
    </span>
  )
}

function DayEntries({ entries }: { entries: ScheduleOccurrence[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((occurrence) => (
        <li key={occurrence.id}>
          <Entry occurrence={occurrence} />
          <OccurrenceMeta occurrence={occurrence} />
        </li>
      ))}
    </ul>
  )
}

/** The date number; today is drawn as a filled disc. */
function DayNumber({ day, isToday }: { day: string; isToday: boolean }) {
  return (
    <time
      dateTime={day}
      className={cn(
        "inline-grid min-w-6 place-items-center rounded-full px-1",
        isToday && "bg-primary font-semibold text-primary-foreground"
      )}
    >
      {utcDay(day).getUTCDate()}
    </time>
  )
}

/**
 * The month and week grid. All seven days always fit: it used to be a
 * 42rem-wide table that hid Friday to Sunday behind a sideways scroll on a
 * phone. Below 36rem of its own width each day is a compact cell (the date
 * and a count); a day with publications is a button that opens that day's
 * list: in a bottom sheet on a phone, beside the grid otherwise (scrolled
 * into view, with focus on its heading). Wider, each cell lists its
 * publications. The table keeps its column headers and caption for screen
 * readers either way. Today carries `aria-current="date"`.
 */
export function CalendarGrid({
  days,
  byDate,
  today,
  month,
  picked,
  onPick,
}: {
  days: string[]
  byDate: ByDate
  /** Today in the organisation's timezone, `YYYY-MM-DD`. */
  today: string
  month: number | null
  picked: string | null
  onPick: (day: string | null) => void
}) {
  // Behaviour only: whether the picked day opens a sheet. Unknown until
  // hydrated, when neither form renders.
  const wide = useHydratedBreakpoint("md")
  const selected = picked && days.includes(picked) ? picked : null
  const selectedEntries = selected ? (byDate.get(selected) ?? []) : []
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
    days.slice(index * 7, index * 7 + 7)
  )
  const headingRef = useRef<HTMLHeadingElement>(null)
  const revealPending = useRef(false)

  useEffect(() => {
    if (!revealPending.current || !selected || !headingRef.current) return
    revealPending.current = false
    headingRef.current.scrollIntoView?.({ block: "nearest" })
    headingRef.current.focus()
  }, [selected])

  return (
    <div className="@container/cal flex min-w-0 flex-col gap-3">
      <div
        role="region"
        aria-label="Calendar grid"
        data-slot="calendar-grid"
        className="min-w-0"
      >
        <Table surface className="table-fixed text-caption">
          <caption className="sr-only">
            Scheduled publications by day. The agenda view lists the same
            publications.
          </caption>
          <TableHeader>
            <TableRow>
              {WEEKDAY_NAMES.map((day) => (
                <TableHead
                  key={day}
                  className="h-auto px-1 py-1.5 text-center @xl/cal:px-2 @xl/cal:text-left"
                >
                  <abbr title={day} className="no-underline">
                    {day.slice(0, 3)}
                  </abbr>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeks.map((week) => (
              <TableRow key={week[0]} className="hover:bg-transparent">
                {week.map((day) => {
                  const entries = byDate.get(day) ?? []
                  const outside =
                    month !== null && utcDay(day).getUTCMonth() !== month
                  const isSelected = selected === day
                  const isToday = day === today
                  return (
                    <TableCell
                      key={day}
                      aria-current={isToday ? "date" : undefined}
                      className={cn(
                        "h-14 border-l border-line p-0.5 align-top first:border-l-0 @xl/cal:h-28 @xl/cal:p-1",
                        outside && "bg-surface-alt"
                      )}
                    >
                      {/* Compact: the date and a count; the day's list opens on a tap. */}
                      <div className="@xl/cal:hidden">
                        {entries.length ? (
                          <button
                            type="button"
                            data-slot="calendar-day"
                            aria-pressed={isSelected}
                            aria-label={`${longDay(day)}${isToday ? " (today)" : ""}, ${countLabel(entries.length)}`}
                            onClick={() => {
                              revealPending.current = !isSelected
                              onPick(isSelected ? null : day)
                            }}
                            className={cn(
                              "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-(--np-radius-control) text-caption tabular-nums focus-halo hover:bg-fill focus-visible:outline-none",
                              outside ? "text-ink-muted" : "text-ink",
                              isSelected && "bg-fill ring-1 ring-line-strong"
                            )}
                          >
                            <DayNumber day={day} isToday={isToday} />
                            <span
                              aria-hidden
                              className="min-w-5 rounded-full bg-info-tint px-1 text-caption font-semibold text-info-ink"
                            >
                              {entries.length}
                            </span>
                          </button>
                        ) : (
                          <p
                            className={cn(
                              "pt-1 text-center text-caption tabular-nums",
                              outside ? "text-ink-muted" : "text-ink"
                            )}
                          >
                            <DayNumber day={day} isToday={isToday} />
                            {isToday ? (
                              <span className="sr-only"> (today)</span>
                            ) : null}
                          </p>
                        )}
                      </div>
                      {/* Wide: the date, then up to three publications. */}
                      <div className="hidden @xl/cal:block">
                        <p
                          className={cn(
                            "px-1.5 text-caption tabular-nums",
                            outside ? "text-ink-muted" : "text-ink"
                          )}
                        >
                          <DayNumber day={day} isToday={isToday} />
                          {isToday ? (
                            <span className="sr-only"> (today)</span>
                          ) : null}
                          {entries.length ? (
                            <span className="sr-only">
                              , {countLabel(entries.length)}
                            </span>
                          ) : null}
                        </p>
                        <ul className="flex flex-col">
                          {entries.slice(0, 3).map((occurrence) => (
                            <li key={occurrence.id}>
                              <Entry occurrence={occurrence} compact />
                            </li>
                          ))}
                        </ul>
                        {entries.length > 3 ? (
                          <p className="px-1.5 text-caption text-ink-muted">
                            +{entries.length - 3} more
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {wide === false ? (
        <Sheet
          open={selected !== null}
          onOpenChange={(open) => {
            if (!open) onPick(null)
          }}
        >
          <SheetContent side="bottom" data-slot="calendar-day-sheet">
            <SheetHeader>
              <SheetTitle>
                {selected ? (
                  <time dateTime={selected}>{longDay(selected)}</time>
                ) : null}
              </SheetTitle>
              <SheetDescription>
                {countLabel(selectedEntries.length)}. Times are the listing’s
                local time.
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <DayEntries entries={selectedEntries} />
            </SheetBody>
          </SheetContent>
        </Sheet>
      ) : wide ? (
        <div
          data-slot="calendar-day-detail"
          aria-live="polite"
          className="@xl/cal:hidden"
        >
          {selected ? (
            <Card
              size="sm"
              aria-label={`Publications on ${longDay(selected)}`}
              role="region"
              className="gap-1"
            >
              <h3
                ref={headingRef}
                tabIndex={-1}
                className="px-(--card-spacing) text-ui font-semibold text-ink outline-none"
              >
                <time dateTime={selected}>{longDay(selected)}</time>
              </h3>
              <div className="px-2">
                <DayEntries entries={selectedEntries} />
              </div>
            </Card>
          ) : days.some((day) => byDate.get(day)?.length) ? (
            <p className="text-caption text-ink-muted">
              Choose a day with publications to see them here, or use Agenda for
              the full list.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function CalendarAgenda({
  days,
  byDate,
  today,
}: {
  days: string[]
  byDate: ByDate
  today: string
}) {
  const withEntries = days.filter((day) => byDate.get(day)?.length)
  if (!withEntries.length)
    return (
      <p className="text-ui text-ink-muted">
        No scheduled publications in this period.
      </p>
    )
  return (
    <ol className="flex flex-col gap-3" aria-label="Scheduled publications">
      {withEntries.map((day) => (
        <li key={day} aria-current={day === today ? "date" : undefined}>
          <Card size="sm" className="gap-1">
            <h3 className="px-(--card-spacing) text-ui font-semibold text-ink">
              <time dateTime={day}>{longDay(day)}</time>
              {day === today ? (
                <span className="ml-2 text-caption font-semibold text-accent-ink">
                  Today
                </span>
              ) : null}
            </h3>
            <div className="px-2">
              <DayEntries entries={byDate.get(day) ?? []} />
            </div>
          </Card>
        </li>
      ))}
    </ol>
  )
}
