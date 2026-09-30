"use client"

import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ClientSelect } from "@/components/performance/client-select"
import { LocationSelect } from "@/components/performance/location-select"
import { Button } from "@/components/ui/button"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { StatusPill, type PillTone } from "@/components/ui/status-pill"
import { fetchScheduleOccurrences } from "@/lib/api/publication-schedules"
import type { ScheduleOccurrence } from "@/lib/contracts/publication-schedules"
import { clockChangeNote } from "@/lib/domain/publication-schedule"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"

type View = "month" | "week" | "agenda"
const DAY = 86_400_000
const STATUS: Record<
  ScheduleOccurrence["status"],
  { label: string; tone: PillTone }
> = {
  scheduled: { label: "Scheduled", tone: "info" },
  publishing: { label: "Publishing", tone: "info" },
  published: { label: "Published", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  ambiguous: { label: "Outcome unknown", tone: "warn" },
  missed: { label: "Missed", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "outline" },
}
const iso = (date: Date) => date.toISOString().slice(0, 10)
const utcDay = (value: string) => new Date(`${value}T00:00:00Z`)
function startOfWeek(date: Date) {
  const day = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - day * DAY)
}

/** Month cells run Monday to Sunday and cover whole weeks. */
function windowFor(view: View, anchor: Date) {
  if (view === "week") {
    const from = startOfWeek(anchor)
    return { from, to: new Date(from.getTime() + 7 * DAY) }
  }
  if (view === "agenda")
    return { from: anchor, to: new Date(anchor.getTime() + 31 * DAY) }
  const first = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)
  )
  const from = startOfWeek(first)
  const last = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)
  )
  return { from, to: new Date(startOfWeek(last).getTime() + 7 * DAY) }
}

/**
 * Every scheduled publication the viewer can see. Dates are each listing's
 * own local date and time, labelled with its timezone; the agenda is the
 * same data as a list, for keyboard and screen-reader use.
 */
export function PublicationCalendar() {
  const [view, setView] = useState<View>("month")
  const [anchor, setAnchor] = useState(() => utcDay(iso(new Date())))
  const [clientId, setClientId] = useState<string | undefined>()
  const [locationId, setLocationId] = useState<string | undefined>()
  const clients = useClients()
  const directory = useLocationDirectory(useSessionRole())
  const range = windowFor(view, anchor)
  // The API window is UTC instants; pad a day each side so local dates near midnight still land.
  const params = {
    from: new Date(range.from.getTime() - DAY).toISOString(),
    to: new Date(range.to.getTime() + DAY).toISOString(),
    clientId,
    locationId,
  }
  const query = useQuery({
    queryKey: queryKeys.scheduleOccurrences(params),
    queryFn: (context) =>
      fetchScheduleOccurrences(params, requestOptions(context)),
  })
  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleOccurrence[]>()
    for (const occurrence of query.data ?? [])
      map.set(occurrence.localDate, [
        ...(map.get(occurrence.localDate) ?? []),
        occurrence,
      ])
    return map
  }, [query.data])
  const days = Array.from(
    { length: Math.round((range.to.getTime() - range.from.getTime()) / DAY) },
    (_, index) => iso(new Date(range.from.getTime() + index * DAY))
  )
  const step = (direction: 1 | -1) =>
    setAnchor((current) =>
      view === "month"
        ? new Date(
            Date.UTC(
              current.getUTCFullYear(),
              current.getUTCMonth() + direction,
              1
            )
          )
        : new Date(
            current.getTime() + direction * (view === "week" ? 7 : 31) * DAY
          )
    )
  const heading =
    view === "month"
      ? new Intl.DateTimeFormat("en-GB", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(anchor)
      : `${iso(range.from)} to ${iso(new Date(range.to.getTime() - DAY))}`
  const clientItems = clients.data?.items ?? []
  const locations = (directory.data ?? [])
    .filter((entry) => !clientId || entry.clientId === clientId)
    .map((entry) => ({ id: entry.id, name: entry.name }))

  return (
    <>
      <PageHeader
        title="Publication calendar"
        description="Scheduled post publications across the listings you can see. Times are each listing’s local time."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => step(-1)}
            aria-label={`Previous ${view === "agenda" ? "period" : view}`}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <h2
            className="min-w-40 text-title font-semibold text-ink"
            aria-live="polite"
          >
            {heading}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => step(1)}
            aria-label={`Next ${view === "agenda" ? "period" : view}`}
          >
            <ChevronRight aria-hidden />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAnchor(utcDay(iso(new Date())))}
          >
            Today
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ClientSelect
            clients={clientItems}
            value={clientId}
            onChange={(next) => {
              setClientId(next)
              setLocationId(undefined)
            }}
          />
          <LocationSelect
            locations={locations}
            value={locationId}
            onChange={setLocationId}
          />
          <SegmentedControl
            value={view}
            onValueChange={(value) => setView(value as View)}
            aria-label="Calendar view"
          >
            <SegmentedControlItem value="month">Month</SegmentedControlItem>
            <SegmentedControlItem value="week">Week</SegmentedControlItem>
            <SegmentedControlItem value="agenda">Agenda</SegmentedControlItem>
          </SegmentedControl>
        </div>
      </div>
      <QueryStates
        status={queryStatus(query)}
        pendingLabel="scheduled publications"
        error="Scheduled publications could not be loaded"
        onRetry={() => void query.refetch()}
      >
        {view === "agenda" ? (
          <Agenda days={days} byDate={byDate} />
        ) : (
          <Grid
            days={days}
            byDate={byDate}
            month={view === "month" ? anchor.getUTCMonth() : null}
          />
        )}
      </QueryStates>
    </>
  )
}

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
      className="flex min-w-0 flex-col gap-0.5 rounded-(--np-radius-control) px-1.5 py-1 text-left focus-halo hover:bg-fill focus-visible:outline-none"
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

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]
const longDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(utcDay(day))
const countLabel = (count: number) =>
  `${count} ${count === 1 ? "publication" : "publications"}`

/**
 * The month and week grid. All seven days always fit: it used to be a
 * 42rem-wide table that hid Friday to Sunday behind a sideways scroll on a
 * phone. Below 36rem of its own width each day is a compact cell (the date
 * and a count); a day with publications is a button that shows that day's
 * full list under the grid. Wider, each cell lists its publications. The
 * table keeps its column headers and caption for screen readers either way.
 */
function Grid({
  days,
  byDate,
  month,
}: {
  days: string[]
  byDate: Map<string, ScheduleOccurrence[]>
  month: number | null
}) {
  const [picked, setPicked] = useState<string | null>(null)
  // A pick from another month or week no longer applies.
  const selected = picked && days.includes(picked) ? picked : null
  const selectedEntries = selected ? (byDate.get(selected) ?? []) : []
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
    days.slice(index * 7, index * 7 + 7)
  )
  return (
    <div className="@container/cal flex min-w-0 flex-col gap-3">
      <div
        role="region"
        aria-label="Calendar grid"
        data-slot="calendar-grid"
        className="min-w-0 rounded-(--np-radius-card) border border-line bg-surface"
      >
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">
            Scheduled publications by day. The agenda view lists the same
            publications.
          </caption>
          <thead>
            <tr>
              {WEEKDAY_NAMES.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className="border-b border-line px-1 py-1.5 text-center text-caption font-semibold text-ink-muted @xl/cal:px-2 @xl/cal:text-left"
                >
                  <abbr title={day} className="no-underline">
                    {day.slice(0, 3)}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day) => {
                  const entries = byDate.get(day) ?? []
                  const outside =
                    month !== null && utcDay(day).getUTCMonth() !== month
                  const isSelected = selected === day
                  return (
                    <td
                      key={day}
                      className={cn(
                        "h-14 border-t border-l border-line p-0.5 align-top first:border-l-0 @xl/cal:h-28 @xl/cal:p-1",
                        outside && "bg-surface-alt"
                      )}
                    >
                      {/* Compact: the date and a count; the day's list opens below. */}
                      <div className="@xl/cal:hidden">
                        {entries.length ? (
                          <button
                            type="button"
                            data-slot="calendar-day"
                            aria-pressed={isSelected}
                            aria-label={`${longDay(day)}, ${countLabel(entries.length)}`}
                            onClick={() =>
                              setPicked(isSelected ? null : day)
                            }
                            className={cn(
                              "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-(--np-radius-control) text-caption tabular-nums focus-halo hover:bg-fill focus-visible:outline-none",
                              outside ? "text-ink-muted" : "text-ink",
                              isSelected && "bg-fill ring-1 ring-line-strong"
                            )}
                          >
                            <time dateTime={day}>
                              {utcDay(day).getUTCDate()}
                            </time>
                            <span
                              aria-hidden
                              className="min-w-5 rounded-full bg-info-tint px-1 text-[11px] leading-4 font-semibold text-info-ink"
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
                            <time dateTime={day}>
                              {utcDay(day).getUTCDate()}
                            </time>
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
                          <time dateTime={day}>
                            {utcDay(day).getUTCDate()}
                          </time>
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
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        data-slot="calendar-day-detail"
        aria-live="polite"
        className="@xl/cal:hidden"
      >
        {selected ? (
          <section
            aria-label={`Publications on ${longDay(selected)}`}
            className="flex flex-col gap-1 rounded-(--np-radius-card) border border-line bg-surface p-3"
          >
            <h3 className="text-ui font-semibold text-ink">
              <time dateTime={selected}>{longDay(selected)}</time>
            </h3>
            <ul className="flex flex-col gap-1">
              {selectedEntries.map((occurrence) => (
                <li key={occurrence.id}>
                  <Entry occurrence={occurrence} />
                  <OccurrenceMeta occurrence={occurrence} />
                </li>
              ))}
            </ul>
          </section>
        ) : days.some((day) => byDate.get(day)?.length) ? (
          <p className="text-caption text-ink-muted">
            Choose a day with publications to see them here, or use Agenda
            for the full list.
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** The listing's timezone, and what a clock change did to this run. */
function OccurrenceMeta({ occurrence }: { occurrence: ScheduleOccurrence }) {
  const note = clockChangeNote(occurrence.adjustment)
  return (
    <span className="block px-1.5 text-caption text-ink-muted">
      {occurrence.timezone}
      {note ? ` · ${note}` : ""}
    </span>
  )
}

function Agenda({
  days,
  byDate,
}: {
  days: string[]
  byDate: Map<string, ScheduleOccurrence[]>
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
        <li
          key={day}
          className="flex flex-col gap-1 rounded-(--np-radius-card) border border-line bg-surface p-3"
        >
          <h3 className="text-ui font-semibold text-ink">
            <time dateTime={day}>{longDay(day)}</time>
          </h3>
          <ul className="flex flex-col gap-1">
            {(byDate.get(day) ?? []).map((occurrence) => (
              <li key={occurrence.id}>
                <Entry occurrence={occurrence} />
                <OccurrenceMeta occurrence={occurrence} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
