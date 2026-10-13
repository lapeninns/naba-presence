"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
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
  Star,
  Unlink,
  UserRoundX,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { PageChrome } from "@/components/app-shell/page-chrome"
import { PageHeader } from "@/components/app-shell/page-frame"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill } from "@/components/ui/status-pill"
import {
  fetchNotifications,
  markNotificationsRead,
  resolveNotification,
  type NotificationFilter,
} from "@/lib/api/operational-notifications"
import type { NotificationItem } from "@/lib/contracts/operational-notifications"
import {
  NOTIFICATION_EVENT_LABELS,
  type NotificationEventKind,
} from "@/lib/domain/notification-preferences"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
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

/** No card on a phone (the empty state is the page); a bordered card from md. */
const EMPTY_FRAME =
  "md:rounded-(--np-radius-card) md:border md:border-line md:bg-surface"

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

/**
 * Operational notifications for the signed-in person. Read state is theirs
 * alone and never resolves anything: a condition clears itself when fixed,
 * and an owner or admin closes an event once handled. Resolving closes it
 * for everyone and there is no reopening, so it asks first.
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
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const client = useQueryClient()
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
  const settle = {
    onSuccess: () => {
      setFailure(null)
      void client.invalidateQueries({ queryKey: queryKeys.notificationsAll })
    },
    onError: (error: unknown) => setFailure(describeActionError(error)),
  }
  const read = useMutation({
    mutationFn: (input: { ids: string[]; read: boolean }) =>
      markNotificationsRead(input.ids, input.read),
    ...settle,
  })
  const resolve = useMutation({
    mutationFn: (id: string) => resolveNotification(id),
    ...settle,
    onSettled: () => setConfirming(null),
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const unread = query.data?.pages[0]?.unreadCount ?? 0
  const unreadShown = items
    .filter((item) => !item.readAt)
    .map((item) => item.id)
  // Only the rows a pending change touches wait for it.
  const pendingIds = new Set<string>([
    ...(read.isPending ? (read.variables?.ids ?? []) : []),
    ...(resolve.isPending && resolve.variables ? [resolve.variables] : []),
  ])

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
      <PageChrome count={unread} countLabel="open and unread" />
      <PageHeader
        title="Notifications"
        meta={
          unread > 0 ? (
            // Notion Mail's "Inbox 99+": the count follows the title in the
            // same size, regular weight, muted. Visual only: the status line
            // under the filter says it in words.
            <span
              aria-hidden
              data-slot="notifications-title-count"
              className="text-page-title font-normal text-ink-muted tabular-nums"
            >
              {unread}
            </span>
          ) : null
        }
        description="Problems and outcomes that need attention. Marking one read does not resolve it."
        actions={
          <Link
            href="/settings/notifications"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Notification settings
          </Link>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={filter}
          onValueChange={setFilter}
          aria-label="Show notifications"
          className="w-full sm:w-auto"
        >
          {FILTERS.map((option) => (
            <SegmentedControlItem key={option.value} value={option.value}>
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
          <p className="text-caption text-ink-muted tabular-nums" role="status">
            {unread} open and unread
          </p>
          <Button
            variant="secondary"
            disabled={!unreadShown.length || read.isPending}
            onClick={() => read.mutate({ ids: unreadShown, read: true })}
          >
            Mark shown as read
          </Button>
        </div>
      </div>
      {failure ? (
        <p role="alert" className="text-ui text-danger-ink">
          {failure}
        </p>
      ) : null}
      <QueryStates
        status={queryStatus(query, { isEmpty: items.length === 0 })}
        pendingLabel="Loading notifications"
        error={{
          title: "Notifications could not be loaded",
          cause: query.error,
        }}
        onRetry={() => void query.refetch()}
        empty={
          filter === DEFAULT_FILTER ? (
            <Empty
              titleAs="h2"
              icon={<BellOffIcon />}
              title="No notifications yet"
              description="Problems with Google connections, publishing and syncs appear here."
              className={EMPTY_FRAME}
            />
          ) : (
            <Empty
              titleAs="h2"
              icon={<BellOffIcon />}
              title="Nothing matches this filter"
              description={FILTERED_EMPTY[filter]}
              className={EMPTY_FRAME}
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
            inbox), a bordered card from md. Each row draws its own inset
            hairline, so the dividers start at the text column. */}
        <ul
          aria-label="Notifications"
          className="-mx-5 flex flex-col md:mx-0 md:overflow-hidden md:rounded-(--np-radius-card) md:border md:border-line md:bg-surface"
        >
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              busy={pendingIds.has(item.id)}
              confirming={confirming === item.id}
              onRead={(value) => read.mutate({ ids: [item.id], read: value })}
              onAskResolve={() => setConfirming(item.id)}
              onCancelResolve={() => setConfirming(null)}
              onResolve={() => resolve.mutate(item.id)}
            />
          ))}
        </ul>
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
 * One notification as a list row, drawn to the shared ListRow spec so it
 * can move onto that primitive when it lands: a neutral kind glyph in a
 * circle, then the text column. Line 1 is what happened and when; unread
 * is said by weight and a small dot after the title, with the word
 * "(unread)" for assistive technology, never by a row tint. Line 2 is the
 * listing and the status word; line 3 the one-sentence description. The
 * actions sit under the text on a phone (44px touch targets) and beside
 * it from md.
 */
function NotificationRow({
  item,
  busy,
  confirming,
  onRead,
  onAskResolve,
  onCancelResolve,
  onResolve,
}: {
  item: NotificationItem
  busy: boolean
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
    <li
      aria-busy={busy || undefined}
      data-slot="notification-row"
      data-unread={unread || undefined}
      className={cn(
        "relative flex min-w-0 items-start gap-3 px-5 py-3 md:px-4",
        // The inset hairline: from the text column (gutter + 36px glyph +
        // 12px gap; 32px glyph at the desk) to the right gutter, and none
        // under the last row.
        "after:absolute after:right-5 after:bottom-0 after:left-17 after:h-px after:bg-line-subtle last:after:hidden md:after:right-4 desk:after:left-15"
      )}
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-ink-secondary desk:size-8 [&_svg]:size-4"
      >
        <Icon strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <p
              className={cn(
                "flex min-w-0 items-center gap-1.5 text-body break-words",
                unread
                  ? "font-semibold text-ink"
                  : "font-normal text-ink-secondary"
              )}
            >
              <span className="min-w-0">{copy.label}</span>
              {unread ? (
                <>
                  {/* Reinforces the word, never replaces it. */}
                  <span
                    aria-hidden
                    data-slot="unread-dot"
                    className="size-1.5 shrink-0 rounded-full bg-info-solid"
                  />
                  <span className="sr-only">(unread)</span>
                </>
              ) : null}
            </p>
            <span className="shrink-0 text-caption whitespace-nowrap text-ink-muted tabular-nums">
              <RelativeTime iso={item.openedAt} />
            </span>
          </div>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted tabular-nums">
            {title ? (
              <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
            ) : null}
            <StatusPill
              tone={item.status === "open" ? "attention" : "outline"}
              plain
            >
              {item.status === "open" ? "Open" : "Resolved"}
            </StatusPill>
            {item.resolvedAt ? (
              <span>
                resolved <RelativeTime iso={item.resolvedAt} />
              </span>
            ) : null}
          </p>
          <p className="text-ui break-words text-ink-secondary max-md:line-clamp-2">
            {copy.description}
          </p>
        </div>
        {confirming ? (
          <div
            role="group"
            aria-label={`Resolve ${copy.label}?`}
            className="flex shrink-0 flex-wrap items-center gap-2 md:max-w-80 md:justify-end"
          >
            <p className="w-full text-caption text-ink-secondary md:text-right">
              Resolve for everyone? It can’t be reopened.
            </p>
            <Button
              ref={confirmRef}
              variant="default"
              disabled={busy}
              onClick={onResolve}
              // The name starts with the words on the button (WCAG 2.5.3),
              // including while it says "Resolving…".
              aria-label={
                busy
                  ? `Resolving… ${copy.label}`
                  : `Yes, resolve: ${copy.label}`
              }
            >
              {busy ? "Resolving…" : "Yes, resolve"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onCancelResolve}>
              Cancel
            </Button>
          </div>
        ) : (
          // Ghost buttons pulled back by their own padding, so their words
          // line up with the text column on a phone.
          <div className="-ml-2.5 flex shrink-0 flex-wrap gap-1 md:ml-0 md:justify-end">
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
              disabled={busy}
              onClick={() => onRead(unread)}
              aria-label={`${unread ? "Mark read" : "Mark unread"}: ${copy.label}`}
            >
              {unread ? "Mark read" : "Mark unread"}
            </Button>
            {item.canResolve ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={onAskResolve}
                aria-label={`Resolve: ${copy.label}`}
              >
                Resolve
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </li>
  )
}
