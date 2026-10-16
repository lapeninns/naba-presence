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
 * The shell bell imports only lib/notifications/pending-store.ts; this module
 * (the overlay, making, ending and committing a change) is the page's.
 */
import {
  notifyManager,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import * as React from "react"

import type {
  NotificationItem,
  NotificationListResponse,
} from "@/lib/contracts/operational-notifications"
import { queryKeys } from "@/lib/queries/keys"

import type { SessionResponse } from "@/lib/contracts/session"
import { sessionScopeToken } from "@/lib/queries/scope-reset"

import { storeFor } from "@/lib/api/operational-notifications"

import {
  type CountPin,
  type KnownRow,
  type PendingChange,
  type RowState,
  type Store,
} from "./pending-store"

/** The scope the session in the cache stands for right now. */
export function currentScopeToken(client: QueryClient): string {
  return sessionScopeToken(
    client.getQueryData<SessionResponse>(queryKeys.session)?.session
  )
}

type FoldRow = RowState & Pick<NotificationItem, "resolvedAt" | "canResolve">

/** The lists a change touches, as the filter each one applies. */
export type ListFilter = "all" | "unread" | "open"

let sequence = 0

/** True while a commit writes the cache: those writes are not new answers. */
let committing = false

/**
 * The badge answer a commit last wrote, per client (the page object itself):
 * the pin never rests on it, since a commit moves the count and drops read
 * rows from the page, which the server did not say. By identity, so a query
 * reset (which restarts its update count) cannot make a real answer look
 * like it.
 */
const ownWrites = new WeakMap<QueryClient, NotificationListResponse>()

/**
 * A change made in one session scope is dropped the moment the session in the
 * cache is another scope, even if it later comes back to the first (A to B to
 * A): what was pending in A's first stretch is not A's second. Watched from
 * the first change a client makes, published in step with the cache's other
 * notifications.
 */
const watched = new WeakSet<QueryClient>()
function watchScope(client: QueryClient, store: Store) {
  if (watched.has(client)) return
  watched.add(client)
  client.getQueryCache().subscribe(() => {
    if (store.changes.length === 0) return
    const token = currentScopeToken(client)
    const kept = store.changes.filter((change) => change.scope === token)
    if (kept.length === store.changes.length) {
      // A newer badge answer may be one the pin can rest on.
      rebasePin(client, store, token)
      // The rows the count leans on may have moved: tell the bell.
      notifyManager.schedule(() => store.listeners.forEach((l) => l()))
      return
    }
    store.changes = kept
    publish(store, true)
  })
}

/**
 * Tells subscribers. `deferred` queues it with the query cache's own
 * observer notifications, so a commit that writes the cache and drops its
 * change reaches React in one render rather than two.
 */
function publish(store: Store, deferred = false) {
  if (store.changes.length === 0) store.pin = null
  const run = () => {
    store.published = store.changes
    store.publishedPin = store.pin
    store.listeners.forEach((listener) => listener())
  }
  if (deferred) notifyManager.schedule(run)
  else run()
}

// ---------------------------------------------------------------------------
// Reading the cache and counting
// ---------------------------------------------------------------------------

export type CachedList = {
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
export function cachedLists(client: QueryClient): CachedList[] {
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
 * The list named `preferred` ("all", "badge"...) wins where lists differ.
 */
export function cachedRowStates(
  client: QueryClient,
  preferred?: string
): Map<string, KnownRow> {
  const rows = new Map<string, KnownRow>()
  const lists = cachedLists(client)
  lists.sort(
    (a, b) => Number(a.filter === preferred) - Number(b.filter === preferred)
  )
  for (const list of lists)
    for (const page of list.pages)
      for (const item of page.items)
        rows.set(item.id, {
          status: item.status,
          readAt: item.readAt,
          openedAt: item.openedAt,
        })
  return rows
}

const countsAsUnread = (row: RowState) => row.status === "open" && !row.readAt

/** A read time that only says "read": a row the whole unread list left out. */
const READ_MARK = "1970-01-01T00:00:00.000Z"

/**
 * A row the unread list, fetched whole, does not hold: it is not unread (read,
 * or resolved), whatever an older list says. Its status is the one the other
 * lists know (a resolved row stays resolved, so marking it unread does not
 * make it count); a row nobody knows is not counted.
 */
function leftOutOfUnreadList(base: RowState | undefined): RowState | undefined {
  return base
    ? { status: base.status, readAt: base.readAt ?? READ_MARK }
    : undefined
}

/**
 * What an Unread list (the shell's badge page, or the Unread filter) proves
 * about a row it does not hold: that the row was not unread when the server
 * gave that list and its count. Its count and its rows came from one answer,
 * so the count has already absorbed any change to such a row. Rows from a
 * list fetched earlier must not say otherwise, or the change is taken off a
 * count that never had the row (a poll that saw a saved read, then the commit).
 *
 * A list read to its end proves it for every row. A list with more to load
 * proves it only for a row that sorts before its last row (the server orders
 * by `openedAt`, newest first): such a row would be on the page had it been
 * unread. A row that sorts after the last row, or one whose `openedAt` is
 * not known, proves nothing: it is off the page whatever its state, so its
 * absence says nothing about the count. The comparison is strict because
 * `openedAt` is only exact to the millisecond.
 */
function unreadListProof(
  filter: string | undefined,
  pages: readonly NotificationListResponse[]
): (openedAt: string | undefined) => boolean {
  if ((filter !== "unread" && filter !== "badge") || pages.length === 0)
    return () => false
  const last = pages[pages.length - 1]!
  if (last.nextCursor === null) return () => true
  const edge = last.items.at(-1)?.openedAt
  if (!edge) return () => false
  const edgeAt = Date.parse(edge)
  return (openedAt) => openedAt !== undefined && Date.parse(openedAt) > edgeAt
}

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
): KnownRow | undefined {
  for (const change of changes) {
    const snapshot = change.snapshots[id]
    if (snapshot) return snapshot
  }
  return undefined
}

/**
 * `change` with the snapshots of the rows `saved` has since made permanent
 * taken as they are after it, not before.
 */
function rebaseOnto(
  saved: PendingChange,
  change: PendingChange
): PendingChange {
  const fold = makeFold([saved])
  let snapshots: Record<string, KnownRow> | null = null
  for (const [id, snapshot] of Object.entries(change.snapshots)) {
    if (!fold.touched.has(id)) continue
    const { status, readAt } = fold.state(snapshot, id)
    if (
      status === snapshot.status &&
      Boolean(readAt) === Boolean(snapshot.readAt)
    )
      continue
    snapshots ??= { ...change.snapshots }
    snapshots[id] = { ...snapshot, status, readAt }
  }
  return snapshots ? { ...change, snapshots } : change
}

/**
 * How far the "open and unread" count moves once `changes` are applied. For
 * every touched row it is unread(final) minus unread(raw), so it does not
 * matter whether the cache has meanwhile caught up with a change: a row the
 * server already shows read adds nothing. `known` says what the cache holds
 * for a row; a row it does not hold falls back to the snapshot taken when the
 * change was made, and a row with neither is not counted.
 *
 * The bell does not use this against a count it is handed: while changes are
 * pending its count is pinned (`CountPin`), and a row's state comes from the
 * snapshot taken when the change was made, so a poll that has already absorbed
 * a change cannot make it count twice. The page's own list leans on its rows
 * and, for rows it does not hold, on `unreadListProof`; where that proves
 * nothing, a row can be counted twice for a short while, and the reconcile
 * refetch that follows every change corrects it.
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

/**
 * How far `changes` move the count, read from the rows as they were when each
 * change was made: the state the pinned count was taken in, whatever the
 * cache has been told since.
 */
function snapshotDelta(changes: readonly PendingChange[]): number {
  return unreadDelta(changes, (id) => snapshotOf(changes, id))
}

/**
 * The shell badge's answer in the cache, if it is loaded: its count and rows,
 * and which answer it is (the query's update count, which moves each time the
 * server's word or a commit is written).
 */
function badgeAnswer(client: QueryClient) {
  const list = cachedLists(client).find((entry) => entry.filter === "badge")
  const first = list?.pages[0]
  if (!list || !first) return undefined
  return {
    count: first.unreadCount,
    pages: list.pages,
    version: client.getQueryState(list.key)?.dataUpdateCount,
  }
}

/**
 * The one total every surface shows while changes are pending: the pinned
 * count plus what the pending changes do to the rows it was taken over. The
 * page and the bell both read it (a refreshed list's own count is not
 * another total), so they cannot disagree. Null when there is no pin to rest
 * on, or nothing pending.
 */
function pinnedTotal(
  changes: readonly PendingChange[],
  pin: CountPin | null,
  token: string
): number | null {
  if (!pin || pin.scope !== token || changes.length === 0) return null
  return pin.count + snapshotDelta(changes)
}

/**
 * Moves the pin onto a badge answer that is newer than the one it rests on,
 * when that answer can account for every row a pending change touches: each
 * is on its first page, or it proves (`unreadListProof`) the row is not
 * unread. Then the answer's count is the pin, and each touched row's snapshot
 * is the row as that answer shows it, so a save a poll has since absorbed is
 * counted once, a review that arrived is counted, and a change taken back
 * after its answer was lost no longer leaves the pin on a count the server has
 * moved from. An answer that leaves a row's state open (a row past the edge
 * of a page that has more) cannot say whether it took a pending change in, so
 * the pin stays where it was, as before.
 *
 * It also gives a pin to a run whose first change was made before the badge
 * was loaded.
 */
function rebasePin(client: QueryClient, store: Store, token: string) {
  // A commit's own writes to the badge are not the server's word.
  if (committing) return
  const answer = badgeAnswer(client)
  if (!answer || answer.version === undefined) return
  if (answer.pages[0] === ownWrites.get(client)) return
  const pin = store.pin?.scope === token ? store.pin : null
  if (pin && pin.answer === answer.version) return
  const held = store.changes.filter((change) => change.scope === token)
  if (held.length === 0) return
  const proves = unreadListProof("badge", answer.pages)
  const shown = new Map<string, KnownRow>()
  for (const page of answer.pages)
    for (const item of page.items)
      shown.set(item.id, {
        status: item.status,
        readAt: item.readAt,
        openedAt: item.openedAt,
      })
  const rows = cachedRowStates(client, "badge")
  const views = new Map<string, KnownRow>()
  for (const change of held)
    for (const id of change.ids) {
      if (views.has(id)) continue
      const row = shown.get(id)
      if (row) {
        views.set(id, row)
        continue
      }
      const base = snapshotOf(held, id) ?? rows.get(id)
      // Nobody knows the row: nothing counts it, before or after.
      if (!base) continue
      if (!proves(base.openedAt)) return
      views.set(id, { ...base, ...leftOutOfUnreadList(base) })
    }
  store.changes = store.changes.map((change) => {
    if (change.scope !== token) return change
    const snapshots = { ...change.snapshots }
    for (const id of change.ids) {
      const view = views.get(id)
      if (view) snapshots[id] = view
    }
    return { ...change, snapshots }
  })
  store.pin = { count: answer.count, scope: token, answer: answer.version }
  publish(store, true)
}

// ---------------------------------------------------------------------------
// The overlay
// ---------------------------------------------------------------------------

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
  otherRows?: ReadonlyMap<string, KnownRow>,
  total?: number | null
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
  const proves = unreadListProof(filter, pages)
  const counted = unreadDelta(changes, (id) => {
    const held = shown.get(id)
    if (held) return held
    const base = otherRows?.get(id) ?? snapshotOf(changes, id)
    return proves(base?.openedAt)
      ? leftOutOfUnreadList(base)
      : otherRows?.get(id)
  })
  // With the total the bell shows (`usePendingUnreadTotal`) the page shows
  // that same number, not its own list's count moved by its own reading.
  const delta =
    total != null && pages[0]
      ? Math.max(0, total) - pages[0].unreadCount
      : counted
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
 * Each row as the shell badge saw it: the pinned count came from that badge
 * answer, so a row it leaves out is not counted in it, whatever an older page
 * list still shows. Rows the badge does not reach keep the state the other
 * lists last gave.
 */
function rowSnapshots(
  client: QueryClient,
  ids: readonly string[]
): Record<string, KnownRow> {
  const rows = cachedRowStates(client, "badge")
  const badge = cachedLists(client).find((list) => list.filter === "badge")
  const leftOut = badge && unreadListProof(badge.filter, badge.pages)
  const snapshots: Record<string, KnownRow> = {}
  for (const id of ids) {
    const row = rows.get(id)
    if (!row) continue
    const inBadge = badge?.pages.some((page) =>
      page.items.some((entry) => entry.id === id)
    )
    snapshots[id] =
      !inBadge && leftOut?.(row.openedAt)
        ? { ...row, ...leftOutOfUnreadList(row) }
        : row
  }
  return snapshots
}

/**
 * Puts a change on the screen at once, before the request goes. Nothing is
 * written to the cache.
 */
export function addPendingChange(
  client: QueryClient,
  input: { kind: "read" | "resolve"; ids: readonly string[]; read?: boolean }
): PendingChange {
  const snapshots = rowSnapshots(client, input.ids)
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
  watchScope(client, store)
  // The first change of a run pins the bell's count: from here to the last
  // commit it is this count plus the changes, not whatever a poll says.
  if (store.changes.length === 0) {
    const answer = badgeAnswer(client)
    store.pin = answer
      ? {
          count: answer.count,
          scope: currentScopeToken(client),
          answer: answer.version,
        }
      : null
  }
  store.delta ??= (cache, prefer) => {
    const token = currentScopeToken(cache)
    const changes = store.published.filter((change) => change.scope === token)
    if (changes.length === 0) return 0
    const own = prefer
      ? cachedLists(cache).find((list) => list.filter === prefer)
      : undefined
    const total = pinnedTotal(changes, store.publishedPin, token)
    if (total !== null && own?.pages[0]) return total - own.pages[0].unreadCount
    const rows = cachedRowStates(cache, prefer)
    // Without a pinned count: the count the bell adds this to came from
    // `prefer`'s own answer, so its rows (and their absence, as far as the
    // list reaches) are the truth for the count, whatever older lists hold.
    if (own) {
      const proves = unreadListProof(own.filter, own.pages)
      const ownRows = new Map<string, RowState>()
      for (const page of own.pages)
        for (const item of page.items)
          ownRows.set(item.id, { status: item.status, readAt: item.readAt })
      return unreadDelta(changes, (id) => {
        const held = ownRows.get(id)
        if (held) return held
        const base = rows.get(id) ?? snapshotOf(changes, id)
        return proves(base?.openedAt) ? leftOutOfUnreadList(base) : rows.get(id)
      })
    }
    return unreadDelta(changes, (id) => rows.get(id))
  }
  store.changes = [...store.changes, change]
  publish(store)
  return change
}

/**
 * Whether the change is still this session's to send and show: the store
 * still holds it and the scope it was made in is still the current one.
 */
export function isChangeLive(
  client: QueryClient,
  change: PendingChange
): boolean {
  return (
    storeFor(client).changes.some((other) => other.id === change.id) &&
    currentScopeToken(client) === change.scope
  )
}

/**
 * Takes back one change, and only that one.
 *
 * A removed change may still have reached the server (its answer was lost),
 * and a poll or refetch since may have shown it. The pin was taken before
 * either, so it still counts every row the change touched as it was then.
 * It moves to count each such row as it is known now: as the changes still
 * out took it, or, for a row none of them touches, as the cache shows it. The
 * survivors' snapshots are left as they are, whatever they say about the
 * row's read or resolved state.
 */
export function removePendingChange(client: QueryClient, id: string): void {
  const store = storeFor(client)
  const removed = store.changes.find((change) => change.id === id)
  if (!removed) return
  const survivors = store.changes.filter((change) => change.id !== id)
  const pin = store.pin
  if (pin && pin.scope === currentScopeToken(client) && survivors.length > 0) {
    const now = rowSnapshots(client, removed.ids)
    let moved = 0
    for (const rowId of removed.ids) {
      const before = snapshotOf(store.changes, rowId)
      const after = snapshotOf(survivors, rowId) ?? now[rowId]
      if (!before || !after) continue
      moved += Number(countsAsUnread(after)) - Number(countsAsUnread(before))
    }
    if (moved) store.pin = { ...pin, count: pin.count + moved }
  }
  store.changes = survivors
  publish(store)
}

/**
 * The server accepted the change (or, with `saved`, only those of its rows):
 * make it permanent in every cached list (each by its own filter, the count
 * moved by the rows that moved) and in the shell badge, and drop it from the
 * store in the same synchronous step. The caller refetches afterwards to take
 * the server's word for the rest.
 *
 * Writes nothing unless the change is still in the store and its session
 * scope is still the current one. A change the store has dropped (the scope
 * moved on, even if it came back) is not this session's to show; it is only
 * removed.
 */
export function commitPendingChange(
  client: QueryClient,
  change: PendingChange,
  saved?: readonly string[]
): void {
  const store = storeFor(client)
  const live = isChangeLive(client, change)
  committing = true
  try {
    notifyManager.batch(() => {
      if (live) {
        // The store's copy of the change: an earlier save may have rebased its
        // snapshots since the caller took the one it holds.
        const current = store.changes.find((other) => other.id === change.id)
        const applied = { ...(current ?? change), ...(saved && { ids: saved }) }
        // Read before any write: each list's delta is judged against the cache
        // as it was, not as the previous list's write left it.
        const rows = cachedRowStates(client)
        // The bell's count once this change is made permanent: the pinned count
        // moved by every change, this one only for what saved. What is still
        // pending then rides on a pin that leaves the total where it was.
        const token = currentScopeToken(client)
        const held = store.changes.filter((other) => other.scope === token)
        const pin = store.pin?.scope === token ? store.pin : null
        const others = held.filter((other) => other.id !== change.id)
        const total = pin
          ? pin.count +
            snapshotDelta(
              held.map((other) => (other.id === change.id ? applied : other))
            )
          : null
        // A change still out for a row this one saved took its snapshot before
        // the save: measured against that, it would move nothing. It is
        // measured against the row as saved, so the pin rests on the committed
        // count and a later refusal of it leaves the bell where the cache is.
        const rebased = new Map(
          others.map((other) => [other.id, rebaseOnto(applied, other)])
        )
        const rest = others.map((other) => rebased.get(other.id)!)
        if (pin && total !== null)
          store.pin = { ...pin, count: total - snapshotDelta(rest) }
        store.changes = store.changes.map(
          (other) => rebased.get(other.id) ?? other
        )
        for (const list of cachedLists(client)) {
          const filter: ListFilter =
            list.filter === "all" || list.filter === "open"
              ? list.filter
              : "unread"
          let pages = applyPendingChanges(
            list.pages,
            [applied],
            filter,
            rows
          ).pages
          // The shell's count is the pinned one, not one taken off rows a poll
          // may already have moved.
          if (list.filter === "badge" && store.pin && pages[0]) {
            const count = Math.max(0, store.pin.count)
            if (pages[0].unreadCount !== count)
              pages = [{ ...pages[0], unreadCount: count }, ...pages.slice(1)]
          }
          if (pages === list.pages) continue
          client.setQueryData(
            list.key,
            list.infinite ? { ...list.data, pages } : pages[0]
          )
        }
      }
      store.changes = store.changes.filter((other) => other.id !== change.id)
      // The badge now holds what the pin says: it rests on that answer.
      const answer = badgeAnswer(client)
      if (answer) ownWrites.set(client, answer.pages[0]!)
      if (store.pin && answer)
        store.pin = { ...store.pin, answer: answer.version }
      publish(store, true)
    })
  } finally {
    committing = false
  }
}

// ---------------------------------------------------------------------------
// Hook
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
 * another scope is never returned (and the store has dropped it).
 */
export function usePendingNotificationChanges(): readonly PendingChange[] {
  const client = useQueryClient()
  const store = storeFor(client)
  const token = useScopeToken(client)
  const all = React.useSyncExternalStore(
    store.subscribe,
    () => store.published,
    () => store.published
  )
  return React.useMemo(
    () => all.filter((change) => change.scope === token),
    [all, token]
  )
}

/**
 * The total the bell shows while changes are pending in this session's scope:
 * the badge's count moved by the pending changes (the pinned count where
 * there is a pin, the rows where there is none), exactly the bell's own sum.
 * The page passes it to `applyPendingChanges` so the two are one number
 * whether or not a pin exists. Null when nothing is pending or the badge is
 * not loaded.
 */
export function usePendingUnreadTotal(): number | null {
  const client = useQueryClient()
  const store = storeFor(client)
  const token = useScopeToken(client)
  const total = React.useSyncExternalStore(
    store.subscribe,
    () => {
      const count = badgeAnswer(client)?.count
      const pending = store.published.some((change) => change.scope === token)
      if (!pending || count === undefined) return null
      return Math.max(0, count + (store.delta?.(client, "badge") ?? 0))
    },
    () => null
  )
  return total
}
