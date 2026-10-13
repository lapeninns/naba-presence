"use client"

import { useQuery } from "@tanstack/react-query"
import { CalendarOffIcon, ChevronLeft, ChevronRight } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import {
  CalendarAgenda,
  CalendarGrid,
} from "@/components/calendar/calendar-grid"
import {
  DEFAULT_VIEW,
  DAY,
  isCalendarView,
  iso,
  parseDay,
  periodHeading,
  stepAnchor,
  todayIn,
  utcDay,
  windowFor,
  type CalendarView,
} from "@/components/calendar/calendar-dates"
import { ClientSelect } from "@/components/performance/client-select"
import { LocationSelect } from "@/components/performance/location-select"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Empty } from "@/components/ui/empty"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { ApiClientError } from "@/lib/api/client"
import { fetchScheduleOccurrences } from "@/lib/api/publication-schedules"
import type { ScheduleOccurrence } from "@/lib/contracts/publication-schedules"
import { useHydrated } from "@/lib/hooks/use-hydrated"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * Every scheduled publication the viewer can see. Dates are each listing's
 * own local date and time, labelled with its timezone; the agenda is the
 * same data as a list, for keyboard and screen-reader use.
 *
 * What is on screen lives in the address: the view (`?view=`, month by
 * default), the period (`?date=`, today by default), the client
 * (`?clientId=`, agency only), the listing (`?locationId=`) and the picked
 * day (`?day=`), so Back from a publication's listing returns to exactly
 * this calendar.
 */
export function PublicationCalendar({
  scheduling = null,
  timeZone,
}: {
  /**
   * The organisation's `post_scheduling` feature as the page read it: `false`
   * renders the not-switched-on state without asking the occurrences route;
   * `null` (unknown) lets the route answer.
   */
  scheduling?: boolean | null
  /** The organisation's timezone; "today" is its date, not UTC's. */
  timeZone?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const role = useSessionRole()
  const business = useWorkspaceMode() === "business"
  const hydrated = useHydrated()
  const [now] = useState(() => new Date())
  // Without the organisation's zone, the browser's own, once it is known:
  // the server's zone is nobody's.
  const today = todayIn(timeZone ?? (hydrated ? undefined : "UTC"), now)

  const viewParam = searchParams.get("view")
  const view: CalendarView = isCalendarView(viewParam)
    ? viewParam
    : DEFAULT_VIEW
  const anchorDay = parseDay(searchParams.get("date")) ?? today
  const anchor = utcDay(anchorDay)
  // A business has no client layer: a stale `?clientId=` is ignored.
  const clientId = business
    ? undefined
    : (searchParams.get("clientId") ?? undefined)
  const locationId = searchParams.get("locationId") ?? undefined
  const picked = parseDay(searchParams.get("day"))

  // Once the route has said "switched off", that is the answer: nothing
  // asks again, whatever the address says next.
  const [offSeen, setOffSeen] = useState(false)
  const off = scheduling === false || offSeen

  const clients = useClients()
  const directory = useLocationDirectory(role)
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
    queryFn: async (context) => {
      try {
        return await fetchScheduleOccurrences(params, requestOptions(context))
      } catch (error) {
        if (isUnavailable(error)) setOffSeen(true)
        throw error
      }
    },
    enabled: !off,
    // Switched off for the workspace is an answer, not a failure to retry.
    retry: (count, error) => !isUnavailable(error) && count < 1,
  })
  const unavailable = off || isUnavailable(query.error)

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

  function replaceParams(mutate: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString())
    mutate(next)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const setAnchorDay = (day: string) =>
    replaceParams((next) => {
      if (day === today) next.delete("date")
      else next.set("date", day)
      // A pick from another month or week no longer applies.
      next.delete("day")
    })
  const setView = (value: string) =>
    replaceParams((next) => {
      if (value === DEFAULT_VIEW) next.delete("view")
      else next.set("view", value)
      if (value === "agenda") next.delete("day")
    })
  const setPicked = (day: string | null) =>
    replaceParams((next) => {
      if (day) next.set("day", day)
      else next.delete("day")
    })

  const heading = periodHeading(view, anchor, range)
  const clientItems = clients.data?.items ?? []
  const locations = (directory.data ?? [])
    .filter((entry) => !clientId || entry.clientId === clientId)
    .map((entry) => ({ id: entry.id, name: entry.name }))
  // One line that names the zones in play: each entry's time is its
  // listing's own, and "today" is the organisation's date.
  const description = timeZone
    ? `Scheduled post publications across the listings you can see. Times are each listing’s local time; today follows ${timeZone}.`
    : "Scheduled post publications across the listings you can see. Times are each listing’s local time."

  if (unavailable) {
    const manager = role === "owner" || role === "admin"
    return (
      <>
        <PageHeader title="Publication calendar" description={description} />
        <Card flush>
          <Empty
            icon={<CalendarOffIcon />}
            titleAs="h2"
            title="Scheduled publishing is off"
            description={
              <>
                Scheduled publishing is not switched on for this workspace.
                {manager
                  ? " It is turned on per workspace by NabaPresence support; ask them when you are ready to schedule posts."
                  : " Ask an owner or admin if you need it."}
              </>
            }
          />
        </Card>
      </>
    )
  }

  const periodNoun = view === "agenda" ? "period" : view
  return (
    <>
      <PageHeader title="Publication calendar" description={description} />
      <div className="flex flex-col gap-3">
        {/* The period header (Notion Mail's month header): the period's name
            on the left, then previous / next as round ghost buttons and a
            plain "Today". */}
        <div className="flex min-w-0 items-center gap-1">
          <h2
            className="min-w-0 flex-1 truncate text-title font-semibold text-ink tabular-nums"
            aria-live="polite"
          >
            {heading}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            pill
            onClick={() => setAnchorDay(iso(stepAnchor(view, anchor, -1)))}
            aria-label={`Previous ${periodNoun}`}
          >
            <ChevronLeft aria-hidden className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            pill
            onClick={() => setAnchorDay(iso(stepAnchor(view, anchor, 1)))}
            aria-label={`Next ${periodNoun}`}
          >
            <ChevronRight aria-hidden className="size-5" />
          </Button>
          <Button variant="ghost" onClick={() => setAnchorDay(today)}>
            Today
          </Button>
        </div>
        {/* Filters share a wrapping row (each full width when two will not
            fit on a phone); the view switch fills its own row there. */}
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex w-full flex-wrap items-end gap-2 empty:hidden sm:w-auto">
            {business ? null : (
              <ClientSelect
                clients={clientItems}
                value={clientId}
                onChange={(next) =>
                  replaceParams((params) => {
                    if (next) params.set("clientId", next)
                    else params.delete("clientId")
                    params.delete("locationId")
                  })
                }
              />
            )}
            <LocationSelect
              locations={locations}
              value={locationId}
              onChange={(next) =>
                replaceParams((params) => {
                  if (next) params.set("locationId", next)
                  else params.delete("locationId")
                })
              }
            />
          </div>
          <SegmentedControl
            value={view}
            onValueChange={setView}
            aria-label="Calendar view"
            className="w-full sm:w-auto"
          >
            <SegmentedControlItem value="month">Month</SegmentedControlItem>
            <SegmentedControlItem value="week">Week</SegmentedControlItem>
            <SegmentedControlItem value="agenda">Agenda</SegmentedControlItem>
          </SegmentedControl>
        </div>
      </div>
      <QueryStates
        status={queryStatus(query)}
        pendingLabel="Loading scheduled publications"
        error={{
          title: "Scheduled publications could not be loaded",
          cause: query.error,
        }}
        onRetry={() => void query.refetch()}
      >
        {view === "agenda" ? (
          <CalendarAgenda days={days} byDate={byDate} today={today} />
        ) : (
          <CalendarGrid
            days={days}
            byDate={byDate}
            today={today}
            month={view === "month" ? anchor.getUTCMonth() : null}
            picked={picked}
            onPick={setPicked}
          />
        )}
      </QueryStates>
    </>
  )
}

/** The organisation's `post_scheduling` feature is off (the occurrences route's 404). */
function isUnavailable(error: unknown) {
  return (
    error instanceof ApiClientError &&
    error.code === "post_scheduling_unavailable"
  )
}
