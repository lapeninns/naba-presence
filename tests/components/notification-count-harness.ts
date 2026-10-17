import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"

import { usePendingUnreadDelta } from "@/lib/api/operational-notifications"
import type {
  NotificationItem,
  NotificationListResponse,
} from "@/lib/contracts/operational-notifications"
import type { SessionResponse, SessionUser } from "@/lib/contracts/session"
import {
  addPendingChange,
  applyPendingChanges,
  cachedRowStates,
  commitPendingChange,
  removePendingChange,
  usePendingNotificationChanges,
  usePendingUnreadTotal,
} from "@/lib/notifications/pending-changes"
import type { PendingChange } from "@/lib/notifications/pending-store"
import { queryKeys } from "@/lib/queries/keys"

export const OWNER: SessionUser = {
  userId: "u1",
  organisationId: "o1",
  organisationName: "Org",
  displayName: "Person",
  email: "person@example.com",
  role: "owner",
  canPublish: true,
  workspaceMode: "business",
  scopeFingerprint: "fp-1",
}
export const READ = "2026-09-30T11:00:00.000Z"

export const row = (id: string, overrides: Partial<NotificationItem> = {}) =>
  ({
    id,
    kind: "publication_failed",
    subjectType: "attempt",
    subjectId: "s",
    locationId: null,
    locationName: null,
    status: "open",
    reason: null,
    summary: {},
    openedAt: "2026-09-30T10:00:00.000Z",
    lastSeenAt: "2026-09-30T10:00:00.000Z",
    resolvedAt: null,
    readAt: null,
    canResolve: true,
    ...overrides,
  }) satisfies NotificationItem
export const read = (id: string, overrides: Partial<NotificationItem> = {}) =>
  row(id, { readAt: READ, ...overrides })
export const resolved = (
  id: string,
  overrides: Partial<NotificationItem> = {}
) =>
  row(id, {
    status: "resolved",
    resolvedAt: READ,
    canResolve: false,
    ...overrides,
  })
const isUnread = (item: NotificationItem) =>
  item.status === "open" && !item.readAt
export const page = (
  items: NotificationItem[],
  unreadCount = items.filter(isUnread).length,
  nextCursor: string | null = null
): NotificationListResponse => ({ items, nextCursor, unreadCount })

/** Lets the query cache tell its subscribers: they are told a tick later. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * The page's count, the bell's count and the raw cached badge, each worked
 * out by the helpers the app uses, over one query client. `refresh` is what a
 * poll and a list refetch bring: the server's rows, and its count.
 */
export function views() {
  const client = new QueryClient()
  client.setQueryData<SessionResponse>(queryKeys.session, { session: OWNER })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  const pending = renderHook(() => usePendingNotificationChanges(), {
    wrapper,
  })
  const delta = renderHook(() => usePendingUnreadDelta("badge"), { wrapper })
  const total = renderHook(() => usePendingUnreadTotal(), { wrapper })
  const all = () =>
    client.getQueryData<{ pages: NotificationListResponse[] }>(
      queryKeys.notifications("all")
    )!
  const badge = () =>
    client.getQueryData<NotificationListResponse>(
      queryKeys.notifications("badge")
    )
  const api = {
    client,
    seed(rows: NotificationItem[], unread: NotificationItem[]) {
      client.setQueryData(queryKeys.notifications("all"), {
        pages: [page(rows)],
        pageParams: [""],
      })
      if (unread)
        client.setQueryData(queryKeys.notifications("badge"), page(unread))
    },
    /** A poll and a list refresh: what the server says now. */
    refresh: (
      rows: NotificationItem[],
      unread: NotificationItem[],
      count = unread.length
    ) =>
      act(async () => {
        client.setQueryData(queryKeys.notifications("all"), {
          pages: [page(rows, count)],
          pageParams: [""],
        })
        client.setQueryData(
          queryKeys.notifications("badge"),
          page(unread, count)
        )
        await flush()
      }),
    /** A list refetch alone: the shell's badge is not loaded. */
    refreshList: (rows: NotificationItem[]) =>
      act(async () => {
        client.setQueryData(queryKeys.notifications("all"), {
          pages: [page(rows)],
          pageParams: [""],
        })
        await flush()
      }),
    /** The shell's poll when its page has more behind it. */
    pollPage: (
      unread: NotificationItem[],
      count: number,
      nextCursor: string | null
    ) =>
      act(async () => {
        client.setQueryData(
          queryKeys.notifications("badge"),
          page(unread, count, nextCursor)
        )
        await flush()
      }),
    /** The shell's poll alone. */
    poll: (unread: NotificationItem[], count = unread.length) =>
      act(async () => {
        client.setQueryData(
          queryKeys.notifications("badge"),
          page(unread, count)
        )
        await flush()
      }),
    make: (input: Parameters<typeof addPendingChange>[1]) => {
      let made!: PendingChange
      act(() => {
        made = addPendingChange(client, input)
      })
      return made
    },
    remove: (made: PendingChange) =>
      act(async () => {
        removePendingChange(client, made.id)
        await flush()
      }),
    commit: (made: PendingChange, saved?: readonly string[]) =>
      act(async () => {
        commitPendingChange(client, made, saved)
        await flush()
      }),
    /** What the page shows, as the notifications page works it out. */
    pageCount: () => {
      act(() => {
        pending.rerender()
        total.rerender()
      })
      return applyPendingChanges(
        all().pages,
        pending.result.current,
        "all",
        cachedRowStates(client),
        total.result.current
      ).unreadCount
    },
    bellCount: () => {
      act(() => delta.rerender())
      return Math.max(0, (badge()?.unreadCount ?? 0) + delta.result.current)
    },
    rawBadge: () => badge()?.unreadCount,
    status: (id: string) =>
      all().pages[0]!.items.find((item) => item.id === id)?.status,
    unmount() {
      pending.unmount()
      delta.unmount()
      total.unmount()
      client.clear()
    },
  }
  return api
}
