"use client"

/**
 * Notification changes that are still on their way to the server, held beside
 * the query cache and never written into it.
 *
 * Marking read, marking unread and resolving show at once. The first design
 * wrote them into the TanStack cache and put a snapshot back on failure. That
 * snapshot is what went wrong: a late rollback restored rows from before a
 * change of session scope (another organisation's, or an owner's, rows shown
 * to a member), an overlapping change rolled back the wrong rows, and the
 * list count and the shell's bell badge could disagree.
 *
 * So the cache keeps only what the server said. A pending change is a small
 * record in a store per query client, laid over the cached rows at render
 * time (`applyPendingChanges`) and over the bell's count
 * (`usePendingUnreadDelta`). Rolling back is deleting the record: only that
 * change's effect goes, whatever else is pending and whatever the cache holds
 * by then. A change belongs to the session scope it was made in
 * (`sessionScopeToken`); once the scope moves on it is neither shown nor
 * committed. When the server accepts a change it is committed into the cached
 * lists in one synchronous step with removing it, so the screen never
 * shows it twice or not at all.
 *
 * Zod-free: the shell bell imports this, and only types come from contracts.
 */
import {
  hashKey,
  notifyManager,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import * as React from "react"

import type { SessionResponse } from "@/lib/contracts/session"
import type {
  NotificationItem,
  NotificationListResponse,
} from "@/lib/contracts/operational-notifications"
import { queryKeys } from "@/lib/queries/keys"
import { sessionScopeToken } from "@/lib/queries/scope-reset"

/** The part of a row that decides whether it counts as "open and unread". */
export type RowState = Pick<NotificationItem, "status" | "readAt">

type FoldRow = RowState & Pick<NotificationItem, "resolvedAt" | "canResolve">

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
  snapshots: Readonly<Record<string, RowState>>
}

/** The lists a change touches, as the filter each one applies. */
export type ListFilter = "all" | "unread" | "open"

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

type Store = {
  /** The truth, for code that is not rendering. */
  changes: readonly PendingChange[]
  /** What subscribers read: it moves with the cache's own notifications. */
  published: readonly PendingChange[]
  listeners: Set<() => void>
}

const stores = new WeakMap<QueryClient, Store>()
let sequence = 0

function storeFor(client: QueryClient): Store {
  let store = stores.get(client)
  if (!store) {
    store = { changes: [], published: [], listeners: new Set() }
    stores.set(client, store)
  }
  return store
}

/**
 * Tells subscribers. `deferred` queues it with the query cache's own
 * observer notifications, so a commit that writes the cache and drops its
 * change reaches React in one render rather than two.
 */
function publish(store: Store, deferred = false) {
  const run = () => {
    store.published = store.changes
    store.listeners.forEach((listener) => listener())
  }
  if (deferred) notifyManager.schedule(run)
  else run()
}

/** The scope the session in the cache stands for right now. */
export function currentScopeToken(client: QueryClient): string {
  return sessionScopeToken(
    client.getQueryData<SessionResponse>(queryKeys.session)?.session
  )
}

// ---------------------------------------------------------------------------
// Reading the cached lists
// ---------------------------------------------------------------------------

type CachedList = {
  key: QueryKey
  /** "badge" is the shell's unread page; the rest are the list's filters. */
  filter: string
  data: Record<string, unknown>
  infinite: boolean
  pages: NotificationListResponse[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** Every cached notifications list: the three filters and the shell badge. */
function cachedLists(client: QueryClient): CachedList[] {
  const lists: CachedList[] = []
  for (const [key, data] of client.getQueriesData<unknown>({
    queryKey: queryKeys.notificationsAll,
  })) {
    if (key[1] !== "list" || typeof key[2] !== "string" || !isRecord(data))
      continue
    if (Array.isArray(data.pages))
      lists.push({
        key,
        filter: key[2],
        data,
        infinite: true,
        pages: data.pages as NotificationListResponse[],
      })
    else if (Array.isArray(data.items))
      lists.push({
        key,
        filter: key[2],
        data,
        infinite: false,
        pages: [data as unknown as NotificationListResponse],
      })
  }
  return lists
}

/**
 * Each row's state as the server last said it, across every cached list.
 * The list whose key hashes to `preferred` wins where lists differ: it is the one on screen.
 */
export function cachedRowStates(
  client: QueryClient,
  preferred?: string
): Map<string, RowState> {
  const rows = new Map<string, RowState>()
  const lists = cachedLists(client)
  lists.sort(
    (a, b) =>
      Number(hashKey(a.key) === preferred) -
      Number(hashKey(b.key) === preferred)
  )
  for (const list of lists)
    for (const page of list.pages)
      for (const item of page.items)
        rows.set(item.id, { status: item.status, readAt: item.readAt })
  return rows
}

// ---------------------------------------------------------------------------
// The overlay
// ---------------------------------------------------------------------------

const countsAsUnread = (row: RowState) => row.status === "open" && !row.readAt

/**
 * The rows `changes` touch, and each row's state once they are applied in
 * the order they were made. A row a change would not alter (read already, or
 * resolved already) comes back as the same object.
 */
function makeFold(changes: readonly PendingChange[]) {
  const sets = changes.map((change) => new Set(change.ids))
  const touched = new Set<string>()
  for (const set of sets) for (const id of set) touched.add(id)
  function apply<T extends FoldRow>(row: T, id: string): T {
    let next = row
    changes.forEach((change, index) => {
      if (!sets[index]!.has(id)) return
      if (change.kind === "read") {
        const value = change.read ?? true
        if (Boolean(next.readAt) === value) return
        next = { ...next, readAt: value ? change.at : null }
      } else if (next.status === "open") {
        next = {
          ...next,
          status: "resolved",
          resolvedAt: change.at,
          canResolve: false,
        }
      }
    })
    return next
  }
  /** The state of a row that is not displayed, only counted. */
  const state = (row: RowState, id: string): RowState =>
    apply({ ...row, resolvedAt: null, canResolve: false }, id)
  return { touched, apply, state }
}

/** The first snapshot a change took of a row. */
function snapshotOf(
  changes: readonly PendingChange[],
  id: string
): RowState | undefined {
  for (const change of changes) {
    const snapshot = change.snapshots[id]
    if (snapshot) return snapshot
  }
  return undefined
}

/**
 * How far the "open and unread" count moves once `changes` are applied. For
 * every touched row it is unread(final) minus unread(raw), so it does not
 * matter whether the cache has meanwhile caught up with a change: a row the
 * server already shows read adds nothing. `known` says what the cache holds
 * for a row; a row it does not hold falls back to the snapshot taken when the
 * change was made, and a row with neither is not counted.
 */
function unreadDelta(
  changes: readonly PendingChange[],
  known: (id: string) => RowState | undefined
): number {
  if (changes.length === 0) return 0
  const fold = makeFold(changes)
  let delta = 0
  for (const id of fold.touched) {
    const raw = known(id) ?? snapshotOf(changes, id)
    if (!raw) continue
    delta +=
      Number(countsAsUnread(fold.state(raw, id))) - Number(countsAsUnread(raw))
  }
  return delta
}

export type AppliedChanges = {
  /** The pages as they are displayed (the same array when nothing changed). */
  pages: NotificationListResponse[]
  /** The change to the "open and unread" count. */
  delta: number
  /** The displayed count: the first page's, plus `delta`, never below 0. */
  unreadCount: number | null
}

/**
 * The list as it is displayed: the cached pages with `changes` laid over
 * them, in order. A row a change touches shows its final state; a row leaves
 * the Unread filter once read and the Open filter once resolved. Rows never
 * enter a list: a row that is not loaded stays out. The count follows
 * `unreadDelta`, reading each row's raw state from `pages` first, then from
 * `otherRows` (the other cached lists), then from the change's snapshot.
 */
export function applyPendingChanges(
  pages: NotificationListResponse[],
  changes: readonly PendingChange[],
  filter: ListFilter,
  otherRows?: ReadonlyMap<string, RowState>
): AppliedChanges {
  if (changes.length === 0)
    return { pages, delta: 0, unreadCount: pages[0]?.unreadCount ?? null }
  const fold = makeFold(changes)
  const shown = new Map<string, RowState>()
  let moved = false
  const next = pages.map((page) => {
    let pageMoved = false
    const items = page.items.flatMap((item) => {
      shown.set(item.id, { status: item.status, readAt: item.readAt })
      if (!fold.touched.has(item.id)) return [item]
      const row = fold.apply(item, item.id)
      const leaves =
        (filter === "unread" && Boolean(row.readAt)) ||
        (filter === "open" && row.status !== "open")
      if (leaves) {
        pageMoved = true
        return []
      }
      if (row !== item) pageMoved = true
      return [row]
    })
    if (!pageMoved) return page
    moved = true
    return { ...page, items }
  })
  const delta = unreadDelta(
    changes,
    (id) => shown.get(id) ?? otherRows?.get(id)
  )
  const result = delta
    ? next.map((page) => ({
        ...page,
        unreadCount: Math.max(0, page.unreadCount + delta),
      }))
    : next
  return {
    pages: moved || delta ? result : pages,
    delta,
    unreadCount: pages[0] ? Math.max(0, pages[0].unreadCount + delta) : null,
  }
}

// ---------------------------------------------------------------------------
// Making, ending and committing a change
// ---------------------------------------------------------------------------

/**
 * Puts a change on the screen at once, before the request goes. Nothing is
 * written to the cache.
 */
export function addPendingChange(
  client: QueryClient,
  input: { kind: "read" | "resolve"; ids: readonly string[]; read?: boolean }
): PendingChange {
  const rows = cachedRowStates(client)
  const snapshots: Record<string, RowState> = {}
  for (const id of input.ids) {
    const row = rows.get(id)
    if (row) snapshots[id] = row
  }
  const change: PendingChange = {
    id: `notification-change-${++sequence}`,
    scope: currentScopeToken(client),
    kind: input.kind,
    ids: [...input.ids],
    read: input.read,
    at: new Date().toISOString(),
    snapshots,
  }
  const store = storeFor(client)
  store.changes = [...store.changes, change]
  publish(store)
  return change
}

/** Takes back one change, and only that one. */
export function removePendingChange(client: QueryClient, id: string): void {
  const store = storeFor(client)
  if (!store.changes.some((change) => change.id === id)) return
  store.changes = store.changes.filter((change) => change.id !== id)
  publish(store)
}

/** Drops every change made in a scope other than `token`. */
function discardOutsideScope(client: QueryClient, token: string): void {
  const store = storeFor(client)
  const kept = store.changes.filter((change) => change.scope === token)
  if (kept.length === store.changes.length) return
  store.changes = kept
  publish(store)
}

/**
 * The server accepted the change: make it permanent in every cached list
 * (each by its own filter, the count moved by the rows that moved) and in the
 * shell badge, and drop it from the store in the same synchronous step. The
 * caller refetches afterwards to take the server's word for the rest.
 *
 * Does nothing to the cache when the session scope has changed since the
 * change was made (it only drops the change): those rows are not this
 * session's to show.
 */
export function commitPendingChange(
  client: QueryClient,
  change: PendingChange
): void {
  const store = storeFor(client)
  notifyManager.batch(() => {
    if (currentScopeToken(client) === change.scope) {
      // Read before any write: each list's delta is judged against the cache
      // as it was, not as the previous list's write left it.
      const rows = cachedRowStates(client)
      for (const list of cachedLists(client)) {
        const filter: ListFilter =
          list.filter === "all" || list.filter === "open"
            ? list.filter
            : "unread"
        const applied = applyPendingChanges(list.pages, [change], filter, rows)
        if (applied.pages === list.pages) continue
        client.setQueryData(
          list.key,
          list.infinite
            ? { ...list.data, pages: applied.pages }
            : applied.pages[0]
        )
      }
    }
    store.changes = store.changes.filter((other) => other.id !== change.id)
    publish(store, true)
  })
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** The session scope in the cache, following it as the cache changes. */
function useScopeToken(client: QueryClient): string {
  // Deferred with the cache's other notifications (as `useScopeReset` does),
  // so no component is updated while another renders.
  const subscribe = React.useCallback(
    (onChange: () => void) =>
      client.getQueryCache().subscribe(notifyManager.batchCalls(onChange)),
    [client]
  )
  const read = React.useCallback(() => currentScopeToken(client), [client])
  return React.useSyncExternalStore(subscribe, read, read)
}

/**
 * The changes still pending in this session's scope. A change made in
 * another scope is never returned, and is discarded.
 */
export function usePendingNotificationChanges(): readonly PendingChange[] {
  const client = useQueryClient()
  const store = storeFor(client)
  const token = useScopeToken(client)
  const all = React.useSyncExternalStore(
    React.useCallback(
      (onChange: () => void) => {
        store.listeners.add(onChange)
        return () => void store.listeners.delete(onChange)
      },
      [store]
    ),
    () => store.published,
    () => store.published
  )
  React.useEffect(() => {
    discardOutsideScope(client, token)
  }, [client, token, all])
  return React.useMemo(
    () => all.filter((change) => change.scope === token),
    [all, token]
  )
}

/**
 * How far this session's pending changes move the "open and unread" count.
 * The page's list and the shell's bell both add it to what the server last
 * said, so they agree while a change is out and roll back together. `prefer`
 * is the cached list whose rows are read first (the badge, for the bell).
 */
export function usePendingUnreadDelta(prefer?: QueryKey): number {
  const client = useQueryClient()
  const store = storeFor(client)
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      store.listeners.add(onChange)
      const unsubscribe = client
        .getQueryCache()
        .subscribe(notifyManager.batchCalls(onChange))
      return () => {
        store.listeners.delete(onChange)
        unsubscribe()
      }
    },
    [client, store]
  )
  const preferred = prefer ? hashKey(prefer) : undefined
  const read = React.useCallback(() => {
    const token = currentScopeToken(client)
    const changes = store.published.filter((change) => change.scope === token)
    if (changes.length === 0) return 0
    const rows = cachedRowStates(client, preferred)
    return unreadDelta(changes, (id) => rows.get(id))
  }, [client, preferred, store])
  return React.useSyncExternalStore(subscribe, read, read)
}
