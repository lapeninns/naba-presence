"use client"

import { useQuery } from "@tanstack/react-query"
import {
  CalendarIcon,
  CalendarOffIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { z } from "zod"

import {
  CalendarAgenda,
  CalendarGrid,
  countLabel,
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
import { useRememberedClient } from "@/components/app-shell/client-context"
import { ClientSelect } from "@/components/performance/client-select"
import { LocationSelect } from "@/components/performance/location-select"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import {
  QueryPending,
  QueryStates,
  queryStatus,
} from "@/components/ui/query-states"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { ViewHeader } from "@/components/ui/view-header"
import { ApiClientError } from "@/lib/api/client"
import { withClientScope } from "@/lib/clients/scope"
import { fetchScheduleOccurrences } from "@/lib/api/publication-schedules"
import type { ScheduleOccurrence } from "@/lib/contracts/publication-schedules"
import { formatTimeZoneLabel } from "@/lib/format"
import { useHydrated } from "@/lib/hooks/use-hydrated"
import { useViewerTimeZone } from "@/lib/hooks/use-viewer-time-zone"
import { queryKeys } from "@/lib/queries/keys"
import { shouldRetryQuery } from "@/lib/queries/query-client"
import { requestOptions } from "@/lib/queries/request-options"
import { useClients } from "@/lib/queries/use-clients"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
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
  const { remembered } = useRememberedClient()
  const hydrated = useHydrated()
  const viewerZone = useViewerTimeZone()
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
  const picked = parseDay(searchParams.get("day"))

  const clients = useClients()
  const directory = useLocationDirectory(role)
  // A filter the viewer cannot pick would narrow the calendar invisibly: the
  // select reads "Every listing" while the request asks for one. So an id
  // from the address counts only if it is one the server accepts and, once
  // the list is known, one the select offers. A business has no client
  // layer, so a stale `?clientId=` is ignored there too.
  const rawClientId = business ? null : searchParams.get("clientId")
  const rawLocationId = searchParams.get("locationId")
  const clientsKnown = clients.isSuccess || clients.isError
  // The directory is keyed by role: wait for the role's own list.
  const directoryKnown =
    (directory.isSuccess && role !== null) || directory.isError
  const clientId = pickableId(
    rawClientId,
    clients.isSuccess ? clients.data.items : null
  )
  const locationId = pickableId(
    rawLocationId,
    directory.isSuccess && role !== null
      ? directory.data.filter(
          (entry) => !clientId || entry.clientId === clientId
        )
      : null
  )
  // A filter in the address is checked before anything is asked for, so the
  // calendar never shows one client and then, once the list arrives, every
  // listing. One that was dropped is said, not silently widened.
  const filtersKnown =
    (!rawClientId || clientsKnown) && (!rawLocationId || directoryKnown)
  const droppedFilter =
    filtersKnown &&
    ((Boolean(rawClientId) && !clientId) ||
      (Boolean(rawLocationId) && !locationId))

  // Once the route has said "switched off", that is the answer: nothing
  // asks again, whatever the address says next.
  const [offSeen, setOffSeen] = useState(false)
  const off = scheduling === false || offSeen

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
    enabled: !off && filtersKnown,
    // Switched off for the workspace is an answer, not a failure to retry;
    // anything else follows the app's own rule.
    retry: (count, error) =>
      !isUnavailable(error) && shouldRetryQuery(count, error),
  })
  const unavailable = off || isUnavailable(query.error)
  // The first load draws the list skeleton; once a period has shown, the
  // next one loads behind an empty grid of its own shape, so the page does
  // not swap to placeholders and back.
  const [settled, setSettled] = useState(false)
  if (!settled && query.isSuccess) setSettled(true)

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
  // A wide cell lists three publications; the rest are in the agenda, which
  // starts at that day.
  const showDayInAgenda = (day: string) =>
    replaceParams((next) => {
      next.set("view", "agenda")
      if (day === today) next.delete("date")
      else next.set("date", day)
      next.delete("day")
    })
  const clearFilters = () =>
    replaceParams((next) => {
      next.delete("clientId")
      next.delete("locationId")
    })

  const heading = periodHeading(view, anchor, range)
  const clientItems = clients.data?.items ?? []
  const locations = (directory.data ?? [])
    .filter((entry) => !clientId || entry.clientId === clientId)
    .map((entry) => ({ id: entry.id, name: entry.name }))
  // Each entry's time is its listing's own, and "today" is the
  // organisation's date. The workspace's zone is named only for a viewer on
  // another clock (the rows' rule), and only once the viewer's zone is known:
  // a zone with no fixed name reads from Intl, whose data the server and the
  // browser can hold differently.
  const zoneName =
    viewerZone && timeZone ? formatTimeZoneLabel(timeZone, viewerZone) : null
  const description = `Every scheduled post across the listings you can see, at each listing’s local time. Open one to manage its schedule on that listing’s Posts tab.${zoneName ? ` Today follows the workspace’s ${zoneName}.` : ""}`
  // Listings keeps the client in scope (agency only), as the navigation's
  // own link does, so it opens already narrowed.
  const listingsHref = business
    ? "/listings"
    : withClientScope("/listings", remembered)

  // How many publications the period holds, and for which filter. A month
  // counts its own days, not the neighbouring months' greyed ones.
  const periodDays =
    view === "month"
      ? days.filter((day) => utcDay(day).getUTCMonth() === anchor.getUTCMonth())
      : days
  const total = periodDays.reduce(
    (sum, day) => sum + (byDate.get(day)?.length ?? 0),
    0
  )
  const filtered = Boolean(clientId || locationId)
  const scopeName = locationId
    ? locations.find((entry) => entry.id === locationId)?.name
    : clientId
      ? clientItems.find((client) => client.id === clientId)?.name
      : undefined
  const periodText = scopeName ? `${heading} for ${scopeName}` : heading
  const header = (
    <div className="flex flex-col gap-1">
      <ViewHeader title="Publication calendar" />
      <p className="max-w-prose text-body text-pretty text-ink-muted">
        {description}
      </p>
    </div>
  )

  if (unavailable) {
    const manager = role === "owner" || role === "admin"
    return (
      <>
        {/* No description above the state: it described scheduled posts on
            a calendar that is not there. */}
        <ViewHeader title="Publication calendar" />
        {/* The state is the page: no toolbar, nothing to retry. Its one
            action is the way back to where posts are written. */}
        <Empty
          variant="not-enabled"
          placement="page"
          icon={<CalendarOffIcon />}
          titleAs="h2"
          title="Scheduled publishing is off"
          // Announced only when it replaces a calendar that was drawing (the
          // route answered); the page's own reading stays a quiet page.
          role={scheduling === false ? undefined : "status"}
          // Who can switch it on, and that it is not a setting to look for.
          // Publishing itself is not promised as immediate: under two-person
          // approval an owner's or admin's own post waits for a second person.
          description={
            manager
              ? "Posts cannot be scheduled in this workspace, so there is nothing to show here. Only NabaPresence support can switch scheduled publishing on; it is not a workspace setting. Posts are published from each listing’s Posts tab."
              : "Posts cannot be scheduled in this workspace, so there is nothing to show here. If you need it, ask an owner or admin to request it from NabaPresence support. Posts are published from each listing’s Posts tab."
          }
          // A "Contact support" action joins this one once a support channel
          // is named (D10).
          action={
            <Link
              href={listingsHref}
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              Go to Listings
            </Link>
          }
        />
      </>
    )
  }

  const periodNoun = view === "agenda" ? "period" : view
  // The one useful next step from an empty period: drop the filter, or go
  // where posts are scheduled.
  const nextStep = (variant: "link" | "secondary") =>
    filtered ? (
      <Button variant={variant} onClick={clearFilters}>
        Show every listing
      </Button>
    ) : (
      <Link href={listingsHref} className={buttonVariants({ variant })}>
        Go to Listings
      </Link>
    )
  const month = view === "month" ? anchor.getUTCMonth() : null
  return (
    <>
      {header}
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
        pending={
          settled && view !== "agenda" ? (
            <div className="flex flex-col gap-3">
              <QueryPending
                label="Loading scheduled publications"
                skeleton={null}
              />
              {/* The period's grid, empty and out of reach until its
                  publications arrive: a screen reader hears only the line
                  above. Never the last period's entries. */}
              <div aria-hidden inert className="opacity-60">
                <CalendarGrid
                  days={days}
                  byDate={NO_ENTRIES}
                  today={today}
                  month={month}
                  picked={null}
                  onPick={ignore}
                  onShowDay={ignore}
                />
              </div>
            </div>
          ) : undefined
        }
        error={{
          title: "Scheduled publications could not be loaded",
          cause: query.error,
          description: loadErrorDescription(query.error),
        }}
        onRetry={() => void query.refetch()}
      >
        {view === "agenda" && total === 0 ? (
          // The agenda has no grid to stand in: the same words as a state.
          <Empty
            size="sm"
            framed
            icon={<CalendarIcon />}
            title={`Nothing scheduled in ${periodText}`}
            description={
              filtered
                ? "Use the arrows to look at another period, or show every listing."
                : "Use the arrows to look at another period. Posts are scheduled from each listing’s Posts tab."
            }
            action={nextStep("secondary")}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {/* One line that answers "how many, for what": an empty month
                says so, and offers the one useful next step. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p role="status" className="text-ui text-pretty text-ink-muted">
                {droppedFilter
                  ? "The filter in this link isn’t one you can pick, so every listing is shown. "
                  : null}
                {total > 0
                  ? `${countLabel(total)} in ${periodText}.`
                  : `Nothing scheduled in ${periodText}.${filtered ? "" : ` Use the arrows to look at another ${periodNoun}. Posts are scheduled from each listing’s Posts tab.`}`}
              </p>
              {total > 0 ? null : nextStep("link")}
            </div>
            {view === "agenda" ? (
              <CalendarAgenda days={days} byDate={byDate} today={today} />
            ) : (
              <CalendarGrid
                days={days}
                byDate={byDate}
                today={today}
                month={month}
                picked={picked}
                onPick={setPicked}
                onShowDay={showDayInAgenda}
              />
            )}
          </div>
        )}
      </QueryStates>
    </>
  )
}

const NO_ENTRIES = new Map<string, ScheduleOccurrence[]>()
const ignore = () => {}
const UUID = z.uuid()

/**
 * A filter id from the address, or undefined when the server would refuse it
 * (not a uuid: a 400 that "Try again" could never fix) or the viewer cannot
 * pick it. `options` is null while that list is unknown (loading, or failed
 * to load), when a well-formed id stands and the server decides what it may
 * see.
 */
function pickableId(
  value: string | null,
  options: readonly { id: string }[] | null
): string | undefined {
  if (!value || !UUID.safeParse(value).success) return undefined
  if (options && !options.some((option) => option.id === value))
    return undefined
  return value
}

/**
 * The calendar reads NabaPresence's own schedule, never Google: a server
 * failure is ours. Anything else keeps the shared wording.
 */
function loadErrorDescription(error: unknown): string | undefined {
  if (error instanceof ApiClientError && error.status >= 500)
    return "NabaPresence could not read the schedule just now. Nothing has changed. Try again in a moment."
  return undefined
}

/** The organisation's `post_scheduling` feature is off (the occurrences route's 404). */
function isUnavailable(error: unknown) {
  return (
    error instanceof ApiClientError &&
    error.code === "post_scheduling_unavailable"
  )
}
