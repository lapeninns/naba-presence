"use client"

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  BellOffIcon,
  CalendarClock,
  CalendarX2,
  CircleAlert,
  CircleHelp,
  ClipboardCheck,
  ClockAlert,
  KeyRound,
  MessageSquareWarning,
  Layers,
  Lightbulb,
  RefreshCw,
  Settings2Icon,
  Star,
  Undo2,
  Unlink,
  UserRoundX,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useMemo, useRef, useState } from "react"

import { PageChrome } from "@/components/app-shell/page-chrome"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty, EmptyIllustration } from "@/components/ui/empty"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { RelativeTime } from "@/components/ui/relative-time"
import { StatusPill } from "@/components/ui/status-pill"
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { ViewHeader } from "@/components/ui/view-header"
import {
  fetchNotifications,
  type NotificationFilter,
} from "@/lib/api/operational-notifications"
import type { NotificationItem } from "@/lib/contracts/operational-notifications"
import {
  CONDITION_KINDS,
  NOTIFICATION_EVENT_LABELS,
  type NotificationEventKind,
} from "@/lib/domain/notification-preferences"
import { reviewNotificationPath } from "@/lib/notifications/links"
import {
  applyPendingChanges,
  cachedRowStates,
  usePendingNotificationChanges,
  usePendingUnreadTotal,
} from "@/lib/notifications/pending-changes"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { cn } from "@/lib/utils"

import { useNotificationChanges } from "./use-notification-changes"

const FILTERS: Array<{ value: NotificationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "open", label: "Open" },
]
const DEFAULT_FILTER: NotificationFilter = "all"

/** What each filter holds, said under the tabs: "Open" is not "Unread". */
const FILTER_HINTS: Record<NotificationFilter, string> = {
  all: "Everything sent to you, newest first.",
  unread: "Notifications you have not marked read, resolved ones included.",
  open: "Problems nobody has resolved yet, whether read or not.",
}

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
  approval_requested: ClipboardCheck,
  reply_sent_back: Undo2,
  publication_failed: CircleAlert,
  publication_unresolved: CircleHelp,
  mutation_unconfirmed: CircleHelp,
  schedule_missed: CalendarX2,
  schedule_blocked: CalendarClock,
  bulk_completed_with_failures: Layers,
  verification_changed: BadgeCheck,
  suggestions_available: Lightbulb,
  resource_stale: RefreshCw,
  review_topic_negative: MessageSquareWarning,
  listing_google_changed: ArrowLeftRight,
}

/**
 * A topic alert opens a filtered list of reviews, not one review. A listing
 * changed on Google opens its Suggested updates tab.
 */
function reviewsLabel(kind: NotificationEventKind): string {
  if (kind === "review_topic_negative") return "Open reviews"
  if (kind === "listing_google_changed") return "Open suggested updates"
  return "Open review"
}

/**
 * Where an account-level notification is fixed, as its email says: it has
 * no listing to open. Only owners and admins receive these kinds, and both
 * pages are theirs.
 */
const ACCOUNT_LINKS: Partial<
  Record<NotificationEventKind, { to: "connections" | "usage"; label: string }>
> = {
  connection_reconnect: { to: "connections", label: "Open Google connections" },
  connection_owner_left: {
    to: "connections",
    label: "Open Google connections",
  },
  ai_credits_low: { to: "usage", label: "See AI credits" },
  ai_credits_exhausted: { to: "usage", label: "See AI credits" },
}

/** The kinds about one Google login, which a row names by its address. */
const LOGIN_KINDS: readonly NotificationEventKind[] = [
  "connection_reconnect",
  "connection_owner_left",
]

function accountLink(kind: NotificationEventKind, usageHref: string) {
  const link = ACCOUNT_LINKS[kind]
  if (!link) return null
  return {
    href: link.to === "connections" ? "/settings/connections" : usageHref,
    label: link.label,
  }
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
 * Read and resolve show at once and put themselves back, with an error
 * toast, if the server refuses. They are pending changes laid over the cached
 * rows, not written into them, so a refusal takes back only its own change and
 * a change from an earlier session scope never shows (see
 * lib/notifications/pending-changes.ts). The page count and the shell's bell
 * add the same pending change to the server's count, so they always agree.
 *
 * The filter lives in the address (`?filter=`, "all" by default), so Back
 * from a listing returns to the same list.
 *
 * `usageHref` is where AI credits are shown on this deployment (Usage with
 * billing on, Reply policy without), passed from the server page.
 */
export function NotificationsView({
  usageHref = "/settings/policy",
}: {
  usageHref?: string
} = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get("filter")
  const filter: NotificationFilter = isFilter(param) ? param : DEFAULT_FILTER
  const [confirming, setConfirming] = useState<string | null>(null)
  const hintId = useId()
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
  const client = useQueryClient()
  // Said politely once the server confirms a resolve: in the Open filter
  // the row has already gone, and nothing else on the page changes.
  const [announcement, setAnnouncement] = useState("")
  const changes = useNotificationChanges({
    onResolved: (label) => setAnnouncement(`${label} resolved for everyone.`),
  })
  const pending = usePendingNotificationChanges()
  // Rows with a resolve still out: they say "Resolving…" until the server
  // answers, never "Resolved" before it has.
  const resolving = useMemo(
    () =>
      new Set(
        pending.flatMap((change) =>
          change.kind === "resolve" ? change.ids : []
        )
      ),
    [pending]
  )
  // The total the bell shows while changes are pending: one number for both.
  const total = usePendingUnreadTotal()
  // The cached rows with every pending change laid over them. Where a row is
  // in another cached list but not this one, that list says what it was.
  const shown = useMemo(
    () =>
      query.data
        ? applyPendingChanges(
            query.data.pages,
            pending,
            filter,
            pending.length ? cachedRowStates(client) : undefined,
            total
          )
        : null,
    [client, filter, pending, total, query.data]
  )
  const items = shown?.pages.flatMap((page) => page.items) ?? []
  // Unknown until the first page arrives: a failed or pending load shows no
  // count at all rather than "0 open and unread" as if it were a fact.
  const unread = shown ? (shown.unreadCount ?? 0) : null
  const unreadShown = items
    .filter((item) => !item.readAt)
    .map((item) => item.id)
  // "Mark all read" (or "Mark N read") goes once nothing shown is unread,
  // and takes keyboard focus with it: the change starts, then focus moves to
  // the current filter tab, so the person keeps their place even if the
  // change is then refused.
  const tabs = useRef<HTMLDivElement>(null)
  function focusFilterTab() {
    tabs.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.focus()
  }
  function markShownRead() {
    changes.markRead(unreadShown, true)
    focusFilterTab()
  }
  // A row that leaves the filtered list takes the focused button with it, so
  // focus goes to the filter tab first, as for "Mark all read", and stays
  // there if the change is then refused.
  const leavesFilter = (action: "read" | "resolve") =>
    (filter === "unread" && action === "read") ||
    (filter === "open" && action === "resolve")

  // Load more and Try again stay focusable while they work (`pending`), but
  // either can leave the page when its fetch settles: Load more after the
  // last page, a Try again once it succeeds. Focus then goes to the first
  // row that arrived (or, failing that, the bottom Try again), or to the
  // filter tab after a refresh; only if it would otherwise fall to the page.
  const rowsArea = useRef<HTMLDivElement>(null)
  const moreRetry = useRef<HTMLButtonElement>(null)
  const settleFocus = useRef<{ to: "rows"; from: number } | { to: "tabs" }>(
    null
  )
  function loadMore() {
    settleFocus.current = { to: "rows", from: items.length }
    void query.fetchNextPage()
  }
  useEffect(() => {
    const target = settleFocus.current
    if (!target || query.isFetching) return
    settleFocus.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    if (target.to === "tabs") return focusFilterTab()
    if (query.isFetchNextPageError) return moreRetry.current?.focus()
    const rows = rowsArea.current?.querySelectorAll('[data-slot="list-row"]')
    const row = rows?.[Math.min(target.from, rows.length - 1)]
    const action = row?.querySelector<HTMLElement>("a, button")
    if (action) action.focus()
    else focusFilterTab()
  }, [query.isFetching, query.isFetchNextPageError, items.length])

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
            // "Settings" on a narrow phone, so the glyph is never alone and
            // the title stays whole; the full words from sm. The name is the
            // full words at every width and holds what is shown.
            <Link
              href="/settings/notifications"
              aria-label="Notification settings"
              className={buttonVariants({ variant: "ghost" })}
            >
              <Settings2Icon aria-hidden />
              <span aria-hidden className="sm:hidden">
                Settings
              </span>
              <span aria-hidden className="max-sm:hidden">
                Notification settings
              </span>
            </Link>
          }
        />
        <p className="max-w-prose text-body text-pretty text-ink-muted">
          Problems and outcomes that need attention. Marking one read does not
          resolve it.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
          <Tabs
            ref={tabs}
            value={filter}
            onValueChange={(value) => setFilter(String(value))}
            className="w-full sm:w-auto"
          >
            <TabsList variant="text" aria-label="Show notifications">
              {FILTERS.map((option) => (
                // The hint describes the filter being shown, so it hangs on
                // that tab: a screen reader says it as focus reaches the tab.
                <TabsTab
                  key={option.value}
                  value={option.value}
                  aria-describedby={
                    option.value === filter ? hintId : undefined
                  }
                >
                  {option.label}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
          <p id={hintId} className="text-caption text-ink-muted">
            {FILTER_HINTS[filter]}
          </p>
        </div>
        {unread !== null ? (
          <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
            <p
              className="text-caption text-ink-muted tabular-nums"
              role="status"
            >
              {unread} open and unread
            </p>
            {unreadShown.length ? (
              // "All" only when every unread notification is in the list:
              // with more to load, or under Open (which leaves resolved
              // unread ones out), the number says what it covers.
              <Button variant="secondary" onClick={markShownRead}>
                {query.hasNextPage || filter === "open"
                  ? `Mark ${unreadShown.length} read`
                  : "Mark all read"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
      {query.isError && query.data && !query.isFetchNextPageError ? (
        // Above the list and the empty state alike: an empty list that could
        // not be refreshed is not known to be empty. A failed Load more is
        // said at the bottom, where it was pressed.
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 text-body text-ink-secondary"
        >
          <p>
            Notifications could not be refreshed. This list may be out of date.
          </p>
          <Button
            variant="secondary"
            pending={query.isFetching && !query.isFetchingNextPage}
            onClick={() => {
              settleFocus.current = { to: "tabs" }
              void query.refetch()
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      <QueryStates
        // Empty only when nothing is shown and nothing more can be loaded: the
        // rows a pending change took off the page must not hide "Load more".
        // A failed refetch keeps the rows already loaded (see the notice).
        status={queryStatus(
          { isPending: query.isPending, isError: query.isError && !query.data },
          { isEmpty: items.length === 0 && !query.hasNextPage }
        )}
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
              description="Approval requests, low-rated reviews and problems with Google connections, publishing or syncs show up here."
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
        {items.length ? (
          // A box-less wrapper, so the rows that a Load more brought can be
          // found for focus: ListRows keeps its own ref.
          <div ref={rowsArea} className="contents">
            <ListRows
              bleed
              aria-label="Notifications"
              className="md:overflow-hidden md:rounded-(--np-radius-card) md:border md:border-line md:bg-surface"
            >
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  accountLink={accountLink(item.kind, usageHref)}
                  resolving={resolving.has(item.id)}
                  confirming={confirming === item.id}
                  onRead={(value) => {
                    changes.markRead([item.id], value)
                    if (value && leavesFilter("read")) focusFilterTab()
                  }}
                  onAskResolve={() => setConfirming(item.id)}
                  onCancelResolve={() => setConfirming(null)}
                  onResolve={() => {
                    setConfirming(null)
                    changes.resolve(
                      item.id,
                      NOTIFICATION_EVENT_LABELS[item.kind].label
                    )
                    if (leavesFilter("resolve")) focusFilterTab()
                  }}
                />
              ))}
            </ListRows>
          </div>
        ) : null}
        {query.isFetchNextPageError ? (
          // Where Load more was pressed, in its place: one retry, not two.
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-body text-ink-secondary"
          >
            <p>More notifications could not be loaded.</p>
            <Button
              ref={moreRetry}
              variant="secondary"
              pending={query.isFetchingNextPage}
              pendingLabel="Loading…"
              onClick={loadMore}
            >
              Try again
            </Button>
          </div>
        ) : query.hasNextPage ? (
          <Button
            variant="secondary"
            className="self-start"
            pending={query.isFetchingNextPage}
            pendingLabel="Loading…"
            onClick={loadMore}
          >
            Load more notifications
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
  accountLink,
  resolving,
  confirming,
  onRead,
  onAskResolve,
  onCancelResolve,
  onResolve,
}: {
  item: NotificationItem
  /** Where an account-level kind is fixed, when there is no other target. */
  accountLink: { href: string; label: string } | null
  /** A resolve is out: not resolved until the server says so. */
  resolving: boolean
  confirming: boolean
  onRead: (read: boolean) => void
  onAskResolve: () => void
  onCancelResolve: () => void
  onResolve: () => void
}) {
  const copy = NOTIFICATION_EVENT_LABELS[item.kind]
  const Icon = KIND_ICONS[item.kind] ?? Bell
  const reviewHref = reviewNotificationPath(item.kind, item.summary)
  const unread = !item.readAt
  // A login's notification has no listing: its address says which login.
  const login =
    LOGIN_KINDS.includes(item.kind) &&
    typeof item.summary.googleEmail === "string" &&
    item.summary.googleEmail
      ? item.summary.googleEmail
      : null
  const title =
    typeof item.summary.title === "string"
      ? item.summary.title
      : (item.locationName ?? login)
  // While a resolve is out the row says so, with no resolved time: the
  // pending change already reads "resolved", the server has not.
  const resolvedAt = resolving ? null : item.resolvedAt
  const captionId = useId()
  // The Resolve button goes when the question appears: focus follows it. And
  // when the question goes (answered or cancelled) its buttons go with it, so
  // focus returns to one of the row's own actions rather than the page: back
  // to Resolve after Cancel, and to the read button after "Yes, resolve" (a
  // resolved row has no Resolve any more). A row that leaves the filtered list
  // is not here to take it: the page moves focus to the filter tab.
  const confirmRef = useRef<HTMLButtonElement>(null)
  const resolveRef = useRef<HTMLButtonElement>(null)
  const readRef = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<"resolve" | "read" | null>(null)
  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus()
      return
    }
    const target = returnTo.current
    returnTo.current = null
    if (target === "resolve") resolveRef.current?.focus()
    else if (target === "read") readRef.current?.focus()
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
        title || resolvedAt ? (
          <>
            {title}
            {title && resolvedAt ? " · " : null}
            {resolvedAt ? (
              <>
                resolved <RelativeTime iso={resolvedAt} />
              </>
            ) : null}
          </>
        ) : null
      }
      trailing={
        resolving ? (
          <StatusPill tone="outline" dashed>
            Resolving…
          </StatusPill>
        ) : (
          <StatusPill
            tone={item.status === "open" ? "attention" : "outline"}
            plain
          >
            {item.status === "open" ? "Open" : "Resolved"}
          </StatusPill>
        )
      }
      preview={copy.description}
      footer={
        // Keyed apart: reusing the question's DOM for the actions turned the
        // green "Yes, resolve" into "Mark unread" mid colour transition.
        confirming ? (
          // Escape is Cancel. The consequence describes both buttons, so it
          // is read with whichever has focus.
          <div
            key="confirm"
            role="group"
            aria-label={`Resolve ${copy.label}?`}
            className="flex min-w-0 flex-wrap items-center gap-2"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              returnTo.current = "resolve"
              onCancelResolve()
            }}
          >
            <p
              id={captionId}
              className="w-full text-caption text-ink-secondary"
            >
              Resolve for everyone? It can’t be reopened.
            </p>
            <Button
              ref={confirmRef}
              variant="default"
              onClick={() => {
                returnTo.current = "read"
                onResolve()
              }}
              // The name starts with the words on the button (WCAG 2.5.3).
              aria-label={`Yes, resolve: ${copy.label}`}
              aria-describedby={captionId}
            >
              Yes, resolve
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                returnTo.current = "resolve"
                onCancelResolve()
              }}
              aria-describedby={captionId}
            >
              Cancel
            </Button>
          </div>
        ) : (
          // Ghost buttons pulled back by their own padding, so their words
          // line up with the text column.
          <div key="actions" className="-ms-2.5 flex min-w-0 flex-wrap gap-1">
            {reviewHref ? (
              <Link
                href={reviewHref}
                className={cn(buttonVariants({ variant: "ghost" }))}
                aria-label={`${reviewsLabel(item.kind)} for ${copy.label}`}
              >
                {reviewsLabel(item.kind)}
              </Link>
            ) : item.locationId ? (
              <Link
                href={`/listings/${item.locationId}`}
                className={cn(buttonVariants({ variant: "ghost" }))}
                aria-label={`Open listing for ${copy.label}`}
              >
                Open listing
              </Link>
            ) : accountLink ? (
              <Link
                href={accountLink.href}
                className={cn(buttonVariants({ variant: "ghost" }))}
                aria-label={`${accountLink.label} for ${copy.label}`}
              >
                {accountLink.label}
              </Link>
            ) : null}
            <Button
              ref={readRef}
              variant="ghost"
              onClick={() => onRead(unread)}
              aria-label={`${unread ? "Mark read" : "Mark unread"}: ${copy.label}`}
            >
              {unread ? "Mark read" : "Mark unread"}
            </Button>
            {item.canResolve ? (
              <Button
                ref={resolveRef}
                variant="ghost"
                onClick={onAskResolve}
                aria-label={`Resolve: ${copy.label}`}
              >
                Resolve
              </Button>
            ) : null}
            {item.status === "open" && !item.canResolve ? (
              // Who closes it, for a row with no Resolve: a condition clears
              // itself; otherwise the server withholds it only by role.
              <p className="basis-full ps-2.5 text-caption text-ink-muted">
                {CONDITION_KINDS.includes(item.kind)
                  ? "Clears on its own once the problem is fixed."
                  : "An owner or admin can resolve this."}
              </p>
            ) : null}
          </div>
        )
      }
    />
  )
}
