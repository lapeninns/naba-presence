import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { expect, it } from "vitest"

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
  usePinnedUnreadCount,
} from "@/lib/notifications/pending-changes"
import type { PendingChange } from "@/lib/notifications/pending-store"
import { queryKeys } from "@/lib/queries/keys"

/**
 * A model of the count invariant. Two rows (X and Y), up to three changes
 * made on them, each ending in one of three ways, and one refresh (a poll
 * and a list refetch that show what the server holds) while the nth change is
 * in flight. The server takes the changes in order, so a change made after
 * the refresh is queued behind the nth and was made with the refreshed cache.
 *
 * Every settled step must leave the page and the bell agreeing, and at the end
 * the page, the bell and the committed badge must hold what the server holds.
 * Only runs where every change settled before the refresh was saved are
 * judged: a change lost before any refresh has shown it leaves the count
 * unknowable to the client until one does.
 */
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
const READ_AT = "2026-09-30T11:00:00.000Z"

type RowModel = { status: "open" | "resolved"; read: boolean }
type Op = readonly ["read" | "unread" | "resolve", "x" | "y"]
type Outcome = "saved" | "refused" | "lost"
const OUTCOMES: readonly Outcome[] = ["saved", "refused", "lost"]

const item = (id: string, model: RowModel): NotificationItem => ({
  id,
  kind: "publication_failed",
  subjectType: "attempt",
  subjectId: "s",
  locationId: null,
  locationName: null,
  status: model.status,
  reason: null,
  summary: {},
  openedAt: "2026-09-30T10:00:00.000Z",
  lastSeenAt: "2026-09-30T10:00:00.000Z",
  resolvedAt: model.status === "resolved" ? READ_AT : null,
  readAt: model.read ? READ_AT : null,
  canResolve: model.status === "open",
})
const counts = (model: RowModel) => model.status === "open" && !model.read
const page = (rows: NotificationItem[]): NotificationListResponse => ({
  items: rows,
  nextCursor: null,
  unreadCount: rows.filter((row) => row.status === "open" && !row.readAt)
    .length,
})

function applyToServer(server: Record<string, RowModel>, [kind, id]: Op) {
  const row = server[id]!
  if (kind === "read") row.read = true
  else if (kind === "unread") row.read = false
  else if (row.status === "open") row.status = "resolved"
}

const pick = <T>(all: readonly T[], length: number, index: number) =>
  Array.from(
    { length },
    (_, at) => all[Math.floor(index / all.length ** at) % all.length]!
  )

async function run(
  ops: readonly Op[],
  outcomes: readonly Outcome[],
  inFlight: number,
  xStartsRead: boolean
): Promise<string[]> {
  const problems: string[] = []
  const client = new QueryClient()
  client.setQueryData<SessionResponse>(queryKeys.session, { session: OWNER })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  const pending = renderHook(() => usePendingNotificationChanges(), { wrapper })
  const delta = renderHook(() => usePendingUnreadDelta("badge"), { wrapper })
  const pinned = renderHook(() => usePinnedUnreadCount(), { wrapper })
  const server: Record<string, RowModel> = {
    x: { status: "open", read: xStartsRead },
    y: { status: "open", read: false },
  }
  const serverRows = () => [item("x", server.x!), item("y", server.y!)]
  const refresh = () => {
    client.setQueryData(queryKeys.notifications("all"), {
      pages: [page(serverRows())],
      pageParams: [""],
    })
    client.setQueryData(
      queryKeys.notifications("badge"),
      page(serverRows().filter((row) => row.status === "open" && !row.readAt))
    )
  }
  refresh()
  const made: PendingChange[] = []
  const add = ([kind, id]: Op) =>
    made.push(
      addPendingChange(client, {
        kind: kind === "resolve" ? "resolve" : "read",
        ids: [id],
        read: kind === "read" ? true : kind === "unread" ? false : undefined,
      })
    )
  const label = `${ops.map((op, at) => `${op.join(" ")}:${outcomes[at]}`).join(", ")} (refresh during #${inFlight + 1}${xStartsRead ? ", X starts read" : ""})`
  const pageCount = () => {
    act(() => pinned.rerender())
    const all = client.getQueryData<{ pages: NotificationListResponse[] }>(
      queryKeys.notifications("all")
    )!
    return applyPendingChanges(
      all.pages,
      pending.result.current,
      "all",
      cachedRowStates(client),
      pinned.result.current
    ).unreadCount
  }
  const badgeCache = () =>
    client.getQueryData<NotificationListResponse>(
      queryKeys.notifications("badge")
    )!.unreadCount
  const bellCount = () => {
    act(() => {
      delta.rerender()
      pending.rerender()
    })
    return Math.max(0, badgeCache() + delta.result.current)
  }
  const agree = (when: string) => {
    if (pageCount() !== bellCount())
      problems.push(
        `${label} ${when}: page ${pageCount()}, bell ${bellCount()}`
      )
  }
  const settle = async (at: number) => {
    await act(async () => {
      if (outcomes[at] === "saved") commitPendingChange(client, made[at]!)
      else removePendingChange(client, made[at]!.id)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    agree(`after #${at + 1}`)
  }

  await act(async () => {
    for (let at = 0; at <= inFlight; at++) add(ops[at]!)
  })
  const judged = outcomes.slice(0, inFlight).every((it) => it === "saved")
  for (let at = 0; at < inFlight; at++) {
    if (outcomes[at] !== "refused") applyToServer(server, ops[at]!)
    await settle(at)
  }
  if (outcomes[inFlight] !== "refused") applyToServer(server, ops[inFlight]!)
  await act(async () => {
    refresh()
    // The cache tells its subscribers a tick later.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  agree("at the refresh")
  await act(async () => {
    for (let at = inFlight + 1; at < ops.length; at++) add(ops[at]!)
  })
  let lostLater = false
  for (let at = inFlight; at < ops.length; at++) {
    if (at > inFlight) {
      if (outcomes[at] !== "refused") applyToServer(server, ops[at]!)
      if (outcomes[at] === "lost") lostLater = true
    }
    await settle(at)
  }
  const expected = Object.values(server).filter(counts).length
  if (!lostLater && (badgeCache() !== expected || pageCount() !== expected))
    problems.push(
      `${label} end: badge ${badgeCache()}, page ${pageCount()}, server ${expected}`
    )
  pending.unmount()
  delta.unmount()
  pinned.unmount()
  client.clear()
  return judged ? problems : []
}

it("keeps page, bell and committed badge on the server's count across saved, refused and lost changes", async () => {
  const sets: { ops: readonly Op[]; length: number }[] = [
    {
      ops: [
        ["read", "x"],
        ["unread", "x"],
        ["resolve", "x"],
        ["read", "y"],
      ],
      length: 2,
    },
    {
      ops: [
        ["read", "x"],
        ["unread", "x"],
        ["resolve", "x"],
      ],
      length: 3,
    },
  ]
  const problems: string[] = []
  let runs = 0
  for (const { ops: alphabet, length } of sets)
    for (const xStartsRead of [false, true])
      for (let inFlight = 0; inFlight < length; inFlight++)
        for (let a = 0; a < alphabet.length ** length; a++)
          for (let b = 0; b < OUTCOMES.length ** length; b++) {
            runs++
            problems.push(
              ...(await run(
                pick(alphabet, length, a),
                pick(OUTCOMES, length, b),
                inFlight,
                xStartsRead
              ))
            )
          }
  expect(runs).toBeGreaterThan(3000)
  expect(problems.slice(0, 20)).toEqual([])
}, 300_000)
