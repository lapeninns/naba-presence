import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { describe, expect, it } from "vitest"

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
  currentScopeToken,
  removePendingChange,
  usePendingNotificationChanges,
} from "@/lib/notifications/pending-changes"
import { usePendingUnreadDelta } from "@/lib/api/operational-notifications"
import type { PendingChange } from "@/lib/notifications/pending-store"
import { queryKeys } from "@/lib/queries/keys"

const row = (id: string, overrides: Partial<NotificationItem> = {}) =>
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
const page = (
  items: NotificationItem[],
  unreadCount = items.filter((i) => i.status === "open" && !i.readAt).length
): NotificationListResponse => ({ items, nextCursor: null, unreadCount })

let counter = 0
const change = (
  overrides: Partial<PendingChange> & Pick<PendingChange, "kind" | "ids">
): PendingChange => ({
  id: `c${++counter}`,
  scope: "",
  at: "2026-10-01T09:00:00.000Z",
  snapshots: {},
  ...overrides,
})

describe("applyPendingChanges", () => {
  it("returns the same pages when nothing is pending", () => {
    const pages = [page([row("a")])]
    const applied = applyPendingChanges(pages, [], "all")
    expect(applied.pages).toBe(pages)
    expect(applied.delta).toBe(0)
    expect(applied.unreadCount).toBe(1)
  })

  it("shows a read row as read and takes one off the count", () => {
    const pages = [page([row("a"), row("b")])]
    const applied = applyPendingChanges(
      pages,
      [change({ kind: "read", ids: ["a"], read: true })],
      "all"
    )
    expect(applied.pages[0]!.items[0]!.readAt).toBe("2026-10-01T09:00:00.000Z")
    expect(applied.pages[0]!.items[1]).toBe(pages[0]!.items[1])
    expect(applied.delta).toBe(-1)
    expect(applied.unreadCount).toBe(1)
    // The cached pages are never mutated.
    expect(pages[0]!.items[0]!.readAt).toBeNull()
  })

  it("marks unread and adds one back, but not for a resolved row", () => {
    const read = "2026-09-30T11:00:00.000Z"
    const pages = [
      page([
        row("a", { readAt: read }),
        row("b", { readAt: read, status: "resolved", canResolve: false }),
      ]),
    ]
    const applied = applyPendingChanges(
      pages,
      [change({ kind: "read", ids: ["a", "b"], read: false })],
      "all"
    )
    expect(applied.pages[0]!.items.map((i) => i.readAt)).toEqual([null, null])
    expect(applied.delta).toBe(1)
    expect(applied.unreadCount).toBe(1)
  })

  it("shows a resolved row as resolved with no Resolve action", () => {
    const applied = applyPendingChanges(
      [page([row("a")])],
      [change({ kind: "resolve", ids: ["a"] })],
      "all"
    )
    expect(applied.pages[0]!.items[0]).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-10-01T09:00:00.000Z",
      canResolve: false,
    })
    expect(applied.delta).toBe(-1)
  })

  it("takes rows out of the Unread filter once read and the Open filter once resolved", () => {
    const pages = [page([row("a"), row("b")])]
    const unread = applyPendingChanges(
      pages,
      [change({ kind: "read", ids: ["a"], read: true })],
      "unread"
    )
    expect(unread.pages[0]!.items.map((i) => i.id)).toEqual(["b"])
    const open = applyPendingChanges(
      pages,
      [change({ kind: "resolve", ids: ["b"] })],
      "open"
    )
    expect(open.pages[0]!.items.map((i) => i.id)).toEqual(["a"])
    // Read does not leave the Open filter, resolve does not leave Unread.
    expect(
      applyPendingChanges(
        pages,
        [change({ kind: "read", ids: ["a"], read: true })],
        "open"
      ).pages[0]!.items
    ).toHaveLength(2)
    expect(
      applyPendingChanges(
        pages,
        [change({ kind: "resolve", ids: ["a"] })],
        "unread"
      ).pages[0]!.items
    ).toHaveLength(2)
  })

  it("never brings a row into a list: an unloaded row stays out", () => {
    const pages = [page([row("a")], 3)]
    const applied = applyPendingChanges(
      pages,
      [change({ kind: "read", ids: ["z"], read: false })],
      "unread",
      new Map([["z", { status: "open", readAt: "2026-09-30T11:00:00.000Z" }]])
    )
    expect(applied.pages[0]!.items.map((i) => i.id)).toEqual(["a"])
    // The count still moves: the unloaded row is in the server's count.
    expect(applied.unreadCount).toBe(4)
  })

  it("applies changes to a row in order, and counts the final state once", () => {
    const pages = [page([row("a")])]
    const read = change({ kind: "read", ids: ["a"], read: true })
    const unread = change({ kind: "read", ids: ["a"], read: false })
    const there = applyPendingChanges(pages, [read, unread], "all")
    expect(there.pages[0]!.items[0]!.readAt).toBeNull()
    expect(there.delta).toBe(0)
    const back = applyPendingChanges(pages, [unread, read], "all")
    expect(back.pages[0]!.items[0]!.readAt).not.toBeNull()
    expect(back.delta).toBe(-1)
  })

  it("is idempotent: a row the cache already shows changed adds nothing", () => {
    // The server's answer has caught up with the change (the row is read and
    // the count is one lower) while the change is still pending.
    const caughtUp = [
      page([row("a", { readAt: "2026-10-01T09:00:00.000Z" })], 0),
    ]
    const applied = applyPendingChanges(
      caughtUp,
      [change({ kind: "read", ids: ["a"], read: true })],
      "all"
    )
    expect(applied.delta).toBe(0)
    expect(applied.unreadCount).toBe(0)
  })

  it("moves only the rows of overlapping changes that are still pending", () => {
    const pages = [page([row("a"), row("b")])]
    const a = change({ kind: "read", ids: ["a"], read: true })
    const b = change({ kind: "read", ids: ["b"], read: true })
    expect(applyPendingChanges(pages, [a, b], "all").unreadCount).toBe(0)
    // A refused: only its contribution goes.
    const afterA = applyPendingChanges(pages, [b], "all")
    expect(afterA.pages[0]!.items.map((i) => Boolean(i.readAt))).toEqual([
      false,
      true,
    ])
    expect(afterA.unreadCount).toBe(1)
    expect(applyPendingChanges(pages, [], "all").unreadCount).toBe(2)
  })

  it("reads a row's raw state from the displayed list, then other lists, then the snapshot", () => {
    const read = change({
      kind: "read",
      ids: ["a"],
      read: true,
      snapshots: { a: { status: "open", readAt: null } },
    })
    const none = [page([], 5)]
    // Other lists say it was already read: no change to the count.
    expect(
      applyPendingChanges(
        none,
        [read],
        "all",
        new Map([["a", { status: "open", readAt: "2026-09-30T11:00:00.000Z" }]])
      ).unreadCount
    ).toBe(5)
    // Nothing cached: the snapshot taken when the change was made.
    expect(applyPendingChanges(none, [read], "all").unreadCount).toBe(4)
    // Nothing anywhere: not counted.
    expect(
      applyPendingChanges(none, [{ ...read, snapshots: {} }], "all").unreadCount
    ).toBe(5)
  })

  it("never shows a count below zero", () => {
    const pages = [page([row("a")], 0)]
    const applied = applyPendingChanges(
      pages,
      [change({ kind: "read", ids: ["a"], read: true })],
      "all"
    )
    expect(applied.unreadCount).toBe(0)
    expect(applied.pages[0]!.unreadCount).toBe(0)
  })
})

describe("pending changes and the session scope", () => {
  const OWNER: SessionUser = {
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
  const setup = () => {
    const client = new QueryClient()
    client.setQueryData<SessionResponse>(queryKeys.session, { session: OWNER })
    client.setQueryData(queryKeys.notifications("all"), {
      pages: [page([row("a"), row("b")])],
      pageParams: [""],
    })
    // The shell's unread page, read to its end: both unread rows are on it.
    client.setQueryData(
      queryKeys.notifications("badge"),
      page([row("a"), row("b")])
    )
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)
    return { client, wrapper }
  }

  it("holds a change only in the scope it was made in", async () => {
    const { client, wrapper } = setup()
    const made = addPendingChange(client, {
      kind: "read",
      ids: ["a"],
      read: true,
    })
    expect(made.scope).toBe(currentScopeToken(client))
    expect(made.snapshots).toEqual({ a: { status: "open", readAt: null } })
    const { result } = renderHook(() => usePendingNotificationChanges(), {
      wrapper,
    })
    expect(result.current).toEqual([made])
    await act(async () => {
      client.setQueryData<SessionResponse>(queryKeys.session, {
        session: { ...OWNER, role: "member", scopeFingerprint: "fp-2" },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current).toEqual([])
    // Gone for good: back in the old scope it does not return.
    await act(async () => {
      client.setQueryData<SessionResponse>(queryKeys.session, {
        session: OWNER,
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current).toEqual([])
  })

  it("adds the same delta for the page and the bell, and drops it with the change", () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => usePendingUnreadDelta("badge"), {
      wrapper,
    })
    expect(result.current).toBe(0)
    let made!: PendingChange
    act(() => {
      made = addPendingChange(client, {
        kind: "read",
        ids: ["a", "b"],
        read: true,
      })
    })
    expect(result.current).toBe(-2)
    act(() => removePendingChange(client, made.id))
    expect(result.current).toBe(0)
  })

  it("does not count a resolved, read row as unread when it is marked unread and the unread page was read whole", () => {
    const { client, wrapper } = setup()
    // The server's unread page leaves out a resolved row that was read; the
    // list the page shows still holds it, resolved and read.
    client.setQueryData(queryKeys.notifications("all"), {
      pages: [
        page([
          row("a"),
          row("b"),
          row("z", {
            status: "resolved",
            resolvedAt: "2026-09-30T11:00:00.000Z",
            readAt: "2026-09-30T11:00:00.000Z",
          }),
        ]),
      ],
      pageParams: [""],
    })
    const { result } = renderHook(() => usePendingUnreadDelta("badge"), {
      wrapper,
    })
    act(() => {
      addPendingChange(client, { kind: "read", ids: ["z"], read: false })
    })
    // It stays resolved, so it never joins "open and unread": the bell has
    // nothing to add (and the page's own count agrees).
    expect(result.current).toBe(0)
    const applied = applyPendingChanges(
      [page([row("a"), row("b")])],
      [
        change({
          kind: "read",
          ids: ["z"],
          read: false,
          snapshots: {
            z: {
              status: "resolved",
              readAt: "2026-09-30T11:00:00.000Z",
            },
          },
        }),
      ],
      "unread"
    )
    expect(applied.delta).toBe(0)
  })

  it("commits into every cached list and the badge, and stops being pending in the same step", () => {
    const { client } = setup()
    client.setQueryData(queryKeys.notifications("unread"), {
      pages: [page([row("a"), row("b")])],
      pageParams: [""],
    })
    const made = addPendingChange(client, {
      kind: "read",
      ids: ["a"],
      read: true,
    })
    commitPendingChange(client, made)
    const all = client.getQueryData<{ pages: NotificationListResponse[] }>(
      queryKeys.notifications("all")
    )!
    expect(all.pages[0]!.items[0]!.readAt).toBe(made.at)
    expect(all.pages[0]!.unreadCount).toBe(1)
    // The Unread filter loses the row, and the count follows.
    const unread = client.getQueryData<{ pages: NotificationListResponse[] }>(
      queryKeys.notifications("unread")
    )!
    expect(unread.pages[0]!.items.map((i) => i.id)).toEqual(["b"])
    expect(unread.pages[0]!.unreadCount).toBe(1)
    // The badge is a single page, not an infinite one.
    const badge = client.getQueryData<NotificationListResponse>(
      queryKeys.notifications("badge")
    )!
    expect(badge.unreadCount).toBe(1)
    expect(badge.items.map((i) => i.id)).toEqual(["b"])
    expect(cachedRowStates(client).get("a")?.readAt).toBe(made.at)
  })

  it("leaves the cache alone when the scope moved on before the commit", () => {
    const { client } = setup()
    const made = addPendingChange(client, {
      kind: "resolve",
      ids: ["a"],
    })
    client.setQueryData<SessionResponse>(queryKeys.session, {
      session: { ...OWNER, organisationId: "o2" },
    })
    const before = client.getQueryData(queryKeys.notifications("all"))
    commitPendingChange(client, made)
    expect(client.getQueryData(queryKeys.notifications("all"))).toBe(before)
  })

  it("drops a change when the scope leaves and comes back, from the store and for the commit", async () => {
    const { client, wrapper } = setup()
    const made = addPendingChange(client, {
      kind: "read",
      ids: ["a"],
      read: true,
    })
    const { result } = renderHook(() => usePendingNotificationChanges(), {
      wrapper,
    })
    expect(result.current).toEqual([made])
    // Away and back with nothing in between to notice: the token is the same
    // as when the change was made.
    client.setQueryData<SessionResponse>(queryKeys.session, {
      session: { ...OWNER, role: "member", scopeFingerprint: "fp-2" },
    })
    client.setQueryData<SessionResponse>(queryKeys.session, { session: OWNER })
    expect(currentScopeToken(client)).toBe(made.scope)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current).toEqual([])
    const before = client.getQueryData(queryKeys.notifications("all"))
    const badge = client.getQueryData(queryKeys.notifications("badge"))
    commitPendingChange(client, made)
    expect(client.getQueryData(queryKeys.notifications("all"))).toBe(before)
    expect(client.getQueryData(queryKeys.notifications("badge"))).toBe(badge)
  })

  it("commits only the rows that saved when told which they were", () => {
    const { client } = setup()
    const made = addPendingChange(client, {
      kind: "read",
      ids: ["a", "b"],
      read: true,
    })
    commitPendingChange(client, made, ["a"])
    const all = client.getQueryData<{ pages: NotificationListResponse[] }>(
      queryKeys.notifications("all")
    )!
    expect(all.pages[0]!.items.map((i) => Boolean(i.readAt))).toEqual([
      true,
      false,
    ])
    expect(all.pages[0]!.unreadCount).toBe(1)
    // The whole change is no longer pending: the rest is the server's to say.
    expect(
      applyPendingChanges(all.pages, [], "all").pages[0]!.items[1]!.readAt
    ).toBeNull()
  })
})
