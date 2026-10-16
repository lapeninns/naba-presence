"use client"

import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query"
import {
  BadgeCheck,
  Bell,
  BellOffIcon,
  CalendarClock,
  CalendarX2,
  CircleAlert,
  CircleHelp,
  ClockAlert,
  KeyRound,
  Layers,
  Lightbulb,
  RefreshCw,
  Settings2Icon,
  Star,
  Unlink,
  UserRoundX,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { PageChrome } from "@/components/app-shell/page-chrome"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty, EmptyIllustration } from "@/components/ui/empty"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill } from "@/components/ui/status-pill"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { showToast } from "@/components/ui/toast"
import { ViewHeader } from "@/components/ui/view-header"
import {
  fetchNotifications,
  markNotificationsRead,
  resolveNotification,
  type NotificationFilter,
} from "@/lib/api/operational-notifications"
import type {
  NotificationItem,
  NotificationListResponse,
} from "@/lib/contracts/operational-notifications"
import {
  NOTIFICATION_EVENT_LABELS,
  type NotificationEventKind,
} from "@/lib/domain/notification-preferences"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useOptimisticMutation } from "@/lib/queries/use-optimistic-mutation"
import { cn } from "@/lib/utils"

const FILTERS: Array<{ value: NotificationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "open", label: "Open" },
]
const DEFAULT_FILTER: NotificationFilter = "all"

/** Why a filtered view is empty, said as what the filter looks for. */
const FILTERED_EMPTY: Record<NotificationFilter, string> = {
  all: "",
  unread: "Every notification has been read.",
  open: "No notification is open.",
}

/**
 * A neutral glyph per kind, for the leading circle of a row. It only helps
 * the eye find a kind again; the label says what happened. A kind added
 * later falls back to the bell.
 */
const KIND_ICONS: Partial<Record<NotificationEventKind, LucideIcon>> = {
  connection_reconnect: Unlink,
  listing_access_lost: KeyRound,
  connection_owner_left: UserRoundX,
  listing_stale: ClockAlert,
  low_rating_review: Star,
  publication_failed: CircleAlert,
  publication_unresolved: CircleHelp,
  mutation_unconfirmed: CircleHelp,
  schedule_missed: CalendarX2,
  schedule_blocked: CalendarClock,
  bulk_completed_with_failures: Layers,
  verification_changed: BadgeCheck,
  suggestions_available: Lightbulb,
  resource_stale: RefreshCw,
}

function isFilter(value: string | null): value is NotificationFilter {
  return FILTERS.some((option) => option.value === value)
}

type NotificationPages = InfiniteData<NotificationListResponse, string>

/** The endpoint takes at most 100 ids at once; a long list is sent in turns. */
const READ_BATCH = 100

/**
 * Read and resolve share one mutation key and one queue. They then see each
 * other's pending changes (so neither refetches, or rolls back, over the
 * other's optimistic change) and reach the server in the order they were made.
 */
const CHANGE_KEY = ["notifications", "change"] as const
const CHANGE_SCOPE = { id: "notifications-change" }

/** What a read request reports: null, or why a later turn was refused. */
type ReadResult = { failure: unknown }

/** What the header count counts: open, and not yet read by this person. */
const countsAsUnread = (item: NotificationItem) =>
  item.status === "open" && !item.readAt

/**
 * The list as it will look once a change succeeds, for the optimistic
 * update. `change` returns the row unchanged (the same object) to leave it
 * alone, a new row to replace it, or null to take it out of this filter's
 * list. The "open and unread" count follows the rows that moved.
 */
function revise(
  current: NotificationPages | undefined,
  change: (item: NotificationItem) => NotificationItem | null
): NotificationPages | undefined {
  if (!current) return undefined
  let delta = 0
  const pages = current.pages.map((page) => ({
    ...page,
    items: page.items.flatMap((item) => {
      const next = change(item)
      if (next === item) return [item]
      delta +=
        (next ? Number(countsAsUnread(next)) : 0) - Number(countsAsUnread(item))
      return next ? [next] : []
    }),
  }))
  return {
    ...current,
    pages: pages.map((page) => ({
      ...page,
      unreadCount: Math.max(0, page.unreadCount + delta),
    })),
  }
}

/**
 * Operational notifications for the signed-in person. Read state is theirs
 * alone and never resolves anything: a condition clears itself when fixed,
 * and an owner or admin closes an event once handled. Resolving closes it
 * for everyone and there is no reopening, so it asks first.
 *
 * Read and resolve show at once and put themselves back, with an error
 * toast, if the server refuses (the list's optimistic recipe, P07).
 *
 * The filter lives in the address (`?filter=`, "all" by default), so Back
 * from a listing returns to the same list.
 */
export function NotificationsView() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get("filter")
  const filter: NotificationFilter = isFilter(param) ? param : DEFAULT_FILTER
  const [confirming, setConfirming] = useState<string | null>(null)
  const query = useInfiniteQuery({
    queryKey: queryKeys.notifications(filter),
    initialPageParam: "",
    queryFn: (context) =>
      fetchNotifications(
        filter,
        context.pageParam || undefined,
        requestOptions(context)
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  // Read and resolve show at once and put themselves right, with an error
  // toast, if the server says no. The variables carry the filter so a late
  // answer settles the list it was made from.
  const read = useOptimisticMutation<
    ReadResult,
    { ids: string[]; read: boolean; filter: NotificationFilter },
    NotificationPages
  >({
    mutationKey: CHANGE_KEY,
    scope: CHANGE_SCOPE,
    // Sends in turns of 100. A turn refused after an earlier one saved is
    // not a failure of the whole change: it reports what is left instead of
    // throwing, so the saved rows stay read and the list is refetched.
    mutationFn: async ({ ids, read: value }) => {
      for (let from = 0; from < ids.length; from += READ_BATCH) {
        try {
          await markNotificationsRead(ids.slice(from, from + READ_BATCH), value)
        } catch (error) {
          if (from === 0) throw error
          return { failure: error }
        }
      }
      return { failure: null }
    },
    onSuccess: ({ failure }) => {
      if (failure === null) return
      showToast({
        id: "notifications-read-partial",
        type: "error",
        title: "Some notifications weren’t marked as read",
        description: describeActionError(failure),
      })
    },
    queryKey: (variables) => queryKeys.notifications(variables.filter),
    alsoInvalidate: [queryKeys.notificationsAll],
    update: (current, { ids, read: value, filter: shown }) =>
      revise(current, (item) => {
        if (!ids.includes(item.id) || Boolean(item.readAt) === value)
          return item
        // The unread filter only lists unread rows: a read one leaves it.
        if (value && shown === "unread") return null
        return { ...item, readAt: value ? new Date().toISOString() : null }
      }),
    errorTitle: "Your change wasn’t saved",
    errorDescription: (error) => describeActionError(error),
  })
  const resolve = useOptimisticMutation<
    unknown,
    { id: string; filter: NotificationFilter },
    NotificationPages
  >({
    mutationKey: CHANGE_KEY,
    scope: CHANGE_SCOPE,
    mutationFn: ({ id }) => resolveNotification(id),
    queryKey: (variables) => queryKeys.notifications(variables.filter),
    alsoInvalidate: [queryKeys.notificationsAll],
    update: (current, { id, filter: shown }) =>
      revise(current, (item) => {
        if (item.id !== id || item.status !== "open") return item
        // The open filter only lists open rows: a resolved one leaves it.
        if (shown === "open") return null
        return {
          ...item,
          status: "resolved",
          resolvedAt: new Date().toISOString(),
          canResolve: false,
        }
      }),
    errorTitle: "The notification wasn’t resolved",
    errorDescription: (error) => describeActionError(error),
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  // Unknown until the first page arrives: a failed or pending load shows no
  // count at all rather than "0 open and unread" as if it were a fact.
  const unread = query.data ? (query.data.pages[0]?.unreadCount ?? 0) : null
  const unreadShown = items
    .filter((item) => !item.readAt)
    .map((item) => item.id)

  function setFilter(value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value === DEFAULT_FILTER) next.delete("filter")
    else next.set("filter", value)
    const search = next.toString()
    router.replace(search ? `${pathname}?${search}` : pathname, {
      scroll: false,
    })
  }

  return (
    <>
      {/* The phone app bar echoes the count after the title; the status
          line below keeps it for assistive technology. */}
      <PageChrome count={unread ?? undefined} countLabel="open and unread" />
      <div className="flex flex-col gap-1">
        {/* Notion Mail's "Inbox 99+": the count follows the title, regular
            weight, muted, and reads as "(open and unread)". */}
        <ViewHeader
          title="Notifications"
          titleAs="h1"
          count={unread ? unread : undefined}
          // The header's screen-reader words replace the figure, so they
          // carry the number (PageChrome's label above is a suffix).
          countLabel={`${unread} open and unread`}
          actions={
            // The words show from sm; on a narrow phone the glyph alone
            // keeps the title whole, and the name stays the same words.
            <Link
              href="/settings/notifications"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "max-sm:w-(--np-control-h) max-sm:px-0"
              )}
            >
              <Settings2Icon aria-hidden />
              <span className="max-sm:sr-only">Notification settings</span>
            </Link>
          }
        />
        <p className="max-w-prose text-body text-pretty text-ink-muted">
          Problems and outcomes that need attention. Marking one read does not
          resolve it.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(String(value))}
          className="w-full sm:w-auto"
        >
          <TabsList variant="text" aria-label="Show notifications">
            {FILTERS.map((option) => (
              <TabsTab key={option.value} value={option.value}>
                {option.label}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
        {unread !== null ? (
          <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
            <p
              className="text-caption text-ink-muted tabular-nums"
              role="status"
            >
              {unread} open and unread
            </p>
            {unreadShown.length ? (
              <Button
                variant="secondary"
                onClick={() =>
                  read.mutate({ ids: unreadShown, read: true, filter })
                }
              >
                {query.hasNextPage ? "Mark shown as read" : "Mark all read"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <QueryStates
        status={queryStatus(query, { isEmpty: items.length === 0 })}
        pendingLabel="Loading notifications"
        error={{
          title: "Notifications could not be loaded",
          cause: query.error,
        }}
        onRetry={() => void query.refetch()}
        empty={
          // The empty state is the page: no card, centred at about 35%.
          filter === DEFAULT_FILTER ? (
            <Empty
              titleAs="h2"
              placement="page"
              icon={<BellOffIcon />}
              title="No notifications yet"
              description="Problems with Google connections, publishing and syncs appear here."
              action={
                <Link
                  href="/settings/notifications"
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Notification settings
                </Link>
              }
            />
          ) : (
            <Empty
              titleAs="h2"
              placement="page"
              illustration={<EmptyIllustration name="inbox-zero" />}
              title="Nothing matches this filter"
              description={FILTERED_EMPTY[filter]}
              action={
                <Button
                  variant="secondary"
                  onClick={() => setFilter(DEFAULT_FILTER)}
                >
                  Show all notifications
                </Button>
              }
            />
          )
        }
      >
        {/* Full-bleed on a phone (the list is the page, as in Notion Mail's
            inbox), a bordered card from md. ListRow draws the inset divider
            from the text column. */}
        <ListRows
          bleed
          aria-label="Notifications"
          className="md:overflow-hidden md:rounded-(--np-radius-card) md:border md:border-line md:bg-surface"
        >
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              confirming={confirming === item.id}
              onRead={(value) =>
                read.mutate({ ids: [item.id], read: value, filter })
              }
              onAskResolve={() => setConfirming(item.id)}
              onCancelResolve={() => setConfirming(null)}
              onResolve={() => {
                setConfirming(null)
                resolve.mutate({ id: item.id, filter })
              }}
            />
          ))}
        </ListRows>
        {query.hasNextPage ? (
          <Button
            variant="secondary"
            className="self-start"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more notifications"}
          </Button>
        ) : null}
      </QueryStates>
    </>
  )
}

/**
 * One notification as a `ListRow` (Notion Mail's mail row): a neutral kind
 * glyph in a circle, then the text column. Line 1 is what happened and
 * when; unread is said by weight and the primitive's dot, with the word
 * "(unread)" for assistive technology, never by a row tint. Line 2 is the
 * listing (and when it was resolved) with the Open/Resolved word trailing;
 * line 3 the one-sentence description. The row itself is not a control:
 * the actions are real buttons in the footer, aligned to the text column,
 * 44px on touch.
 */
function NotificationRow({
  item,
  confirming,
  onRead,
  onAskResolve,
  onCancelResolve,
  onResolve,
}: {
  item: NotificationItem
  confirming: boolean
  onRead: (read: boolean) => void
  onAskResolve: () => void
  onCancelResolve: () => void
  onResolve: () => void
}) {
  const copy = NOTIFICATION_EVENT_LABELS[item.kind]
  const Icon = KIND_ICONS[item.kind] ?? Bell
  const unread = !item.readAt
  const title =
    typeof item.summary.title === "string"
      ? item.summary.title
      : item.locationName
  // The Resolve button goes when the question appears: focus follows it.
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])
  return (
    <ListRow
      interactive={false}
      emphasis={unread ? "unread" : "read"}
      unreadLabel="(unread)"
      leading={
        <span
          aria-hidden
          className="grid size-full place-items-center rounded-full bg-avatar-bg text-avatar-ink [&_svg]:size-4"
        >
          <Icon strokeWidth={1.75} />
        </span>
      }
      title={copy.label}
      meta={<RelativeTime iso={item.openedAt} />}
      subtitle={
        title || item.resolvedAt ? (
          <>
            {title}
            {title && item.resolvedAt ? " · " : null}
            {item.resolvedAt ? (
              <>
                resolved <RelativeTime iso={item.resolvedAt} />
              </>
            ) : null}
          </>
        ) : null
      }
      trailing={
        <StatusPill
          tone={item.status === "open" ? "attention" : "outline"}
          plain
        >
          {item.status === "open" ? "Open" : "Resolved"}
        </StatusPill>
      }
      preview={copy.description}
      footer={
        // Keyed apart: reusing the question's DOM for the actions turned the
        // green "Yes, resolve" into "Mark unread" mid colour transition.
        confirming ? (
          <div
            key="confirm"
            role="group"
            aria-label={`Resolve ${copy.label}?`}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <p className="w-full text-caption text-ink-secondary">
              Resolve for everyone? It can’t be reopened.
            </p>
            <Button
              ref={confirmRef}
              variant="default"
              onClick={onResolve}
              // The name starts with the words on the button (WCAG 2.5.3).
              aria-label={`Yes, resolve: ${copy.label}`}
            >
              Yes, resolve
            </Button>
            <Button variant="ghost" onClick={onCancelResolve}>
              Cancel
            </Button>
          </div>
        ) : (
          // Ghost buttons pulled back by their own padding, so their words
          // line up with the text column.
          <div key="actions" className="-ms-2.5 flex min-w-0 flex-wrap gap-1">
            {item.locationId ? (
              <Link
                href={`/listings/${item.locationId}`}
                className={cn(buttonVariants({ variant: "ghost" }))}
                aria-label={`Open listing for ${copy.label}`}
              >
                Open listing
              </Link>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => onRead(unread)}
              aria-label={`${unread ? "Mark read" : "Mark unread"}: ${copy.label}`}
            >
              {unread ? "Mark read" : "Mark unread"}
            </Button>
            {item.canResolve ? (
              <Button
                variant="ghost"
                onClick={onAskResolve}
                aria-label={`Resolve: ${copy.label}`}
              >
                Resolve
              </Button>
            ) : null}
          </div>
        )
      }
    />
  )
}
