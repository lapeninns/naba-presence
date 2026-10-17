/**
 * The types of the pending notification changes, shared by the shell's bell
 * and the notifications page. Types only, so nothing here is bundled.
 *
 * The store itself (`storeFor`) and the bell's `usePendingUnreadDelta` are in
 * lib/api/operational-notifications.ts, and the code that works out the count
 * and the displayed rows is in lib/notifications/pending-changes.ts. The
 * split is for the shell's weight: the shell loads on every route, so it
 * carries only the store and the hook, and the page's module registers the
 * counting on the store with the first change (`store.delta`). The store is
 * in that API module, not a module of its own, because a module shared by the
 * shell and a page entry becomes a chunk of its own, and an extra chunk costs
 * more than the code in it (route-js: the dashboard shell +0.7 KB gzip).
 */
import type { QueryClient } from "@tanstack/react-query"

import type { NotificationItem } from "@/lib/contracts/operational-notifications"

/** The part of a row that decides whether it counts as "open and unread". */
export type RowState = Pick<NotificationItem, "status" | "readAt">

/** A row as the cache knows it: its state, and where it sorts in the lists. */
export type KnownRow = RowState & { openedAt?: string }

export type PendingChange = {
  id: string
  /** `sessionScopeToken` when the change was made. */
  scope: string
  kind: "read" | "resolve"
  ids: readonly string[]
  /** For `read`: true marks read, false marks unread. */
  read?: boolean
  /** When the change was made: what the row shows as its read or resolved time. */
  at: string
  /**
   * Each row's state in the cache when the change was made. Only a fallback,
   * for a row no cached list holds any more; the cache is the first witness.
   */
  snapshots: Readonly<Record<string, KnownRow>>
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * The shell's unread count as it stood when the first of the changes now
 * pending was made, moved on by each change that commits since.
 */
export type CountPin = {
  count: number
  scope: string
  /**
   * The badge answer the count rests on (the badge query's `dataUpdateCount`
   * when it was taken), so a newer answer is noticed and the pin can move
   * onto it (`rebasePin` in lib/notifications/pending-changes.ts). Absent
   * when the answer is not known.
   */
  answer?: number
}

export type Store = {
  /** The truth, for code that is not rendering. */
  changes: readonly PendingChange[]
  /** What subscribers read: it moves with the cache's own notifications. */
  published: readonly PendingChange[]
  /**
   * The bell's count while changes are pending: this, plus the changes, and
   * never the count a shell poll or refetch brings meanwhile, which may or
   * may not already have absorbed them and cannot be told which. Null when no
   * change is pending, or the shell's count was not loaded when one was made.
   */
  pin: CountPin | null
  publishedPin: CountPin | null
  listeners: Set<() => void>
  subscribe: (onChange: () => void) => () => void
  /**
   * How far this session's pending changes move the open-and-unread count,
   * reading the rows from the cache (`prefer` names the list read first). Set
   * by the page's module with the first change; there is nothing to count
   * before one exists.
   */
  delta: ((client: QueryClient, prefer?: string) => number) | null
}
