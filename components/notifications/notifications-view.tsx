"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { BellOffIcon } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
import { NOTIFICATION_EVENT_LABELS } from "@/lib/domain/notification-preferences"
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
      <PageHeader
        title="Notifications"
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
          <Card flush>
            <Empty
              titleAs="h2"
              icon={<BellOffIcon />}
              title="Nothing here"
              description={
                filter === "all"
                  ? "No notifications yet."
                  : "Nothing matches this filter."
              }
            />
          </Card>
        }
      >
        <Card flush>
          <ul
            className="flex flex-col divide-y divide-line"
            aria-label="Notifications"
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
        </Card>
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
 * One notification as a record card: what happened and its status word,
 * one sentence, one meta line (listing and when), then the actions at the
 * 44px touch size.
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
      className={cn(
        "flex min-w-0 flex-col gap-2 px-4 py-3 md:flex-row md:items-start md:justify-between",
        !item.readAt && "bg-surface-alt"
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex items-start justify-between gap-2 text-ui font-semibold text-ink md:justify-start">
          <span className="flex min-w-0 items-center gap-2">
            {!item.readAt ? (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                aria-hidden
              />
            ) : null}
            <span>{copy.label}</span>
            {!item.readAt ? <span className="sr-only">(unread)</span> : null}
          </span>
          <StatusPill
            tone={item.status === "open" ? "attention" : "outline"}
            plain
          >
            {item.status === "open" ? "Open" : "Resolved"}
          </StatusPill>
        </p>
        <p className="text-ui break-words text-ink-secondary">
          {copy.description}
        </p>
        <p className="text-caption text-ink-muted">
          {title ? `${title} · ` : ""}
          <RelativeTime iso={item.openedAt} />
          {item.resolvedAt ? (
            <>
              {" "}
              · resolved <RelativeTime iso={item.resolvedAt} />
            </>
          ) : null}
        </p>
      </div>
      {confirming ? (
        <div
          role="group"
          aria-label={`Resolve ${copy.label}?`}
          className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end"
        >
          <p className="w-full text-caption text-ink-secondary md:w-auto">
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
              busy ? `Resolving… ${copy.label}` : `Yes, resolve: ${copy.label}`
            }
          >
            {busy ? "Resolving…" : "Yes, resolve"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancelResolve}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap gap-1 md:justify-end">
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
            onClick={() => onRead(!item.readAt)}
            aria-label={`${item.readAt ? "Mark unread" : "Mark read"}: ${copy.label}`}
          >
            {item.readAt ? "Mark unread" : "Mark read"}
          </Button>
          {item.canResolve ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={onAskResolve}
              aria-label={`Resolve: ${copy.label}`}
            >
              Resolve
            </Button>
          ) : null}
        </div>
      )}
    </li>
  )
}
