"use client"

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { StatusPill } from "@/components/ui/status-pill"
import {
  fetchNotifications,
  markNotificationsRead,
  resolveNotification,
  type NotificationFilter,
} from "@/lib/api/operational-notifications"
import { ApiClientError } from "@/lib/api/client"
import type { NotificationItem } from "@/lib/contracts/operational-notifications"
import { NOTIFICATION_EVENT_LABELS } from "@/lib/domain/notification-preferences"
import { formatRelativeTime } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { cn } from "@/lib/utils"

const FILTERS: Array<{ value: NotificationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "open", label: "Open" },
]

/**
 * Operational notifications for the signed-in person. Read state is theirs
 * alone and never resolves anything: a condition clears itself when fixed,
 * and an owner or admin closes an event once handled.
 */
export function NotificationsView() {
  const [filter, setFilter] = useState<NotificationFilter>("all")
  const [failure, setFailure] = useState<string | null>(null)
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
    onError: (error: unknown) =>
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "That change could not be saved. Try again."
      ),
  }
  const read = useMutation({
    mutationFn: (input: { ids: string[]; read: boolean }) =>
      markNotificationsRead(input.ids, input.read),
    ...settle,
  })
  const resolve = useMutation({
    mutationFn: (id: string) => resolveNotification(id),
    ...settle,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const unread = query.data?.pages[0]?.unreadCount ?? 0
  const unreadShown = items
    .filter((item) => !item.readAt)
    .map((item) => item.id)

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Problems and outcomes that need attention. Marking one read does not resolve it."
        actions={
          <Link
            href="/settings/notifications"
            className={buttonVariants({ variant: "secondary" })}
          >
            Notification settings
          </Link>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={filter}
          onValueChange={(value) => setFilter(value as NotificationFilter)}
          aria-label="Show notifications"
        >
          {FILTERS.map((option) => (
            <SegmentedControlItem key={option.value} value={option.value}>
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <div className="flex items-center gap-3">
          <p className="text-caption text-ink-muted tabular-nums" role="status">
            {unread} open and unread
          </p>
          <Button
            variant="secondary"
            size="sm"
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
        pendingLabel="notifications"
        error="Notifications could not be loaded"
        onRetry={() => void query.refetch()}
        empty={
          <div className="rounded-(--np-radius-card) border border-line bg-surface">
            <Empty
              title="Nothing here"
              description={
                filter === "all"
                  ? "No notifications yet."
                  : "Nothing matches this filter."
              }
            />
          </div>
        }
      >
        <ul
          className="flex flex-col divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
          aria-label="Notifications"
        >
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              busy={read.isPending || resolve.isPending}
              onRead={(value) => read.mutate({ ids: [item.id], read: value })}
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
            Load more notifications
          </Button>
        ) : null}
      </QueryStates>
    </>
  )
}

function NotificationRow({
  item,
  busy,
  onRead,
  onResolve,
}: {
  item: NotificationItem
  busy: boolean
  onRead: (read: boolean) => void
  onResolve: () => void
}) {
  const copy = NOTIFICATION_EVENT_LABELS[item.kind]
  const title =
    typeof item.summary.title === "string"
      ? item.summary.title
      : item.locationName
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between",
        !item.readAt && "bg-surface-alt"
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-ui font-semibold text-ink">
          {!item.readAt ? (
            <span
              className="size-2 shrink-0 rounded-full bg-primary"
              aria-hidden
            />
          ) : null}
          <span>{copy.label}</span>
          {!item.readAt ? <span className="sr-only">(unread)</span> : null}
          <StatusPill tone={item.status === "open" ? "warn" : "outline"} plain>
            {item.status === "open" ? "Open" : "Resolved"}
          </StatusPill>
        </p>
        <p className="text-ui break-words text-ink-secondary">
          {title ? `${title}: ` : ""}
          {copy.description}
        </p>
        <p className="text-caption text-ink-muted">
          <time dateTime={item.openedAt}>
            {formatRelativeTime(item.openedAt)}
          </time>
          {item.resolvedAt ? (
            <>
              {" "}
              · resolved{" "}
              <time dateTime={item.resolvedAt}>
                {formatRelativeTime(item.resolvedAt)}
              </time>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1 sm:justify-end">
        {item.locationId ? (
          <Link
            href={`/listings/${item.locationId}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            aria-label={`Open listing for ${copy.label}`}
          >
            Open listing
          </Link>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onRead(!item.readAt)}
          aria-label={`${item.readAt ? "Mark unread" : "Mark read"}: ${copy.label}`}
        >
          {item.readAt ? "Mark unread" : "Mark read"}
        </Button>
        {item.canResolve ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onResolve}
            aria-label={`Resolve: ${copy.label}`}
          >
            Resolve
          </Button>
        ) : null}
      </div>
    </li>
  )
}
