import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

// A working address bar: router.replace rewrites what useSearchParams reads.
const nav = vi.hoisted(() => {
  let search = ""
  const listeners = new Set<() => void>()
  return {
    get search() {
      return search
    },
    set(next: string) {
      search = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
})
vi.mock("next/navigation", async () => {
  const React = await import("react")
  return {
    useRouter: () => ({
      replace: (url: string) => nav.set(url.split("?")[1] ?? ""),
      push: vi.fn(),
    }),
    usePathname: () => "/notifications",
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          nav.subscribe,
          () => nav.search,
          () => nav.search
        )
      ),
  }
})

import { NotificationsLink } from "@/components/app-shell/notifications-link"
import { NotificationsView } from "@/components/notifications/notifications-view"
import { useNotificationChanges } from "@/components/notifications/use-notification-changes"
import { NotificationPreferences } from "@/components/settings/notification-preferences"
import { Toaster } from "@/components/ui/toast"
import type { SessionResponse, SessionUser } from "@/lib/contracts/session"
import type { ShellStatusResponse } from "@/lib/contracts/shell-status"
import { queryKeys } from "@/lib/queries/keys"
import { useScopeReset } from "@/lib/queries/scope-reset"
import { seedShellKeys } from "@/lib/queries/use-shell-status"

const LOCATION = "11111111-1111-4111-8111-111111111111"
const item = (overrides: Record<string, unknown>) => ({
  id: "22222222-2222-4222-8222-222222222222",
  kind: "publication_failed",
  subjectType: "attempt",
  subjectId: "s",
  locationId: LOCATION,
  locationName: "Old Crown",
  status: "open",
  reason: "provider_rejected",
  summary: { title: "Old Crown" },
  openedAt: "2026-09-30T10:00:00.000Z",
  lastSeenAt: "2026-09-30T10:00:00.000Z",
  resolvedAt: null,
  readAt: null,
  canResolve: true,
  ...overrides,
})
const READ_AT = "2026-09-30T11:00:00.000Z"
type Call = { url: string; method: string; body: unknown }
function stub(routes: (call: Call) => unknown) {
  const calls: Call[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = {
        url: String(url),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      }
      calls.push(call)
      return new Response(JSON.stringify(routes(call)), {
        headers: { "content-type": "application/json" },
      })
    })
  )
  return calls
}
const renderWith = (node: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>
  )
/** The view under the app's toaster: errors from a change arrive as toasts. */
const renderView = () =>
  renderWith(
    <Toaster>
      <NotificationsView />
    </Toaster>
  )
type ServerOptions = {
  items: (Record<string, unknown> & { id: string })[]
  /** A path ("read" or "resolve") answered with a refusal. */
  fail?: "read" | "resolve"
  /** A path held until `release()`. */
  hold?: "read" | "resolve"
  /** The first list call returns this cursor: more pages exist. */
  nextCursor?: string | null
  /** Read calls after this many succeed are refused (a failed later batch). */
  failReadAfter?: number
}
/**
 * A server that keeps the notifications: read and resolve change what the
 * next list returns, so a refetch after a change shows the real answer.
 */
function notificationServer({
  items,
  fail,
  hold,
  nextCursor = null,
  failReadAfter,
}: ServerOptions) {
  let state = items
  let readCalls = 0
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const calls: Call[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = {
        url: String(url),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      }
      calls.push(call)
      const path = call.url.endsWith("/api/notifications/read")
        ? "read"
        : call.url.endsWith("/resolve")
          ? "resolve"
          : "list"
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        })
      if (path === "list") {
        const filter = new URL(call.url, "http://x").searchParams.get("filter")
        const shown = state.filter((row) =>
          filter === "unread"
            ? !row.readAt
            : filter === "open"
              ? row.status === "open"
              : true
        )
        return json({
          items: shown,
          nextCursor,
          unreadCount: state.filter(
            (row) => row.status === "open" && !row.readAt
          ).length,
        })
      }
      if (hold === path) await gate
      if (path === "read" && failReadAfter !== undefined)
        if (readCalls++ >= failReadAfter)
          return json(
            { error: "internal_error", message: "Something broke." },
            500
          )
      if (fail === path)
        return json(
          { error: "internal_error", message: 'relation "x" does not exist' },
          500
        )
      if (path === "read") {
        const { incidentIds, read } = call.body as {
          incidentIds: string[]
          read: boolean
        }
        state = state.map((row) =>
          incidentIds.includes(row.id)
            ? { ...row, readAt: read ? "2026-10-01T09:00:00.000Z" : null }
            : row
        )
        return json({ updated: incidentIds.length })
      }
      state = state.map((row) =>
        call.url.includes(row.id)
          ? {
              ...row,
              status: "resolved",
              resolvedAt: "2026-10-01T09:00:00.000Z",
              canResolve: false,
            }
          : row
      )
      return json({ resolved: true })
    })
  )
  return { calls, release: () => release() }
}
const readCalls = (calls: Call[]) =>
  calls.filter((call) => call.url.endsWith("/api/notifications/read"))
afterEach(() => {
  nav.set("")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("NotificationsView", () => {
  it("marks read without resolving and resolves only through the resolve action", async () => {
    const calls = stub((call) =>
      call.url.includes("/read")
        ? { updated: 1 }
        : call.url.includes("/resolve")
          ? { resolved: true }
          : { items: [item({})], nextCursor: null, unreadCount: 1 }
    )
    renderView()
    expect(await screen.findByText("Publishing failed")).toBeInTheDocument()
    expect(screen.getByText(/\(unread\)/)).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")
    fireEvent.click(
      screen.getByRole("button", { name: "Mark read: Publishing failed" })
    )
    await waitFor(() =>
      expect(
        calls.some((call) => call.url.endsWith("/api/notifications/read"))
      ).toBe(true)
    )
    expect(
      calls.find((call) => call.url.endsWith("/api/notifications/read"))?.body
    ).toEqual({ incidentIds: [item({}).id], read: true })
    expect(calls.some((call) => call.url.includes("/resolve"))).toBe(false)
    fireEvent.click(
      screen.getByRole("button", { name: "Resolve: Publishing failed" })
    )
    // Resolving closes it for everyone and cannot be undone: it asks first.
    expect(calls.some((call) => call.url.includes("/resolve"))).toBe(false)
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
    )
    await waitFor(() =>
      expect(
        calls.some((call) =>
          call.url.endsWith(`/api/notifications/${item({}).id}/resolve`)
        )
      ).toBe(true)
    )
  })
  it("offers no resolve action for a condition and links to the listing", async () => {
    stub(() => ({
      items: [
        item({
          kind: "listing_access_lost",
          canResolve: false,
          readAt: "2026-09-30T11:00:00.000Z",
        }),
      ],
      nextCursor: null,
      unreadCount: 0,
    }))
    renderView()
    expect(await screen.findByText("Listing access lost")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Resolve/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Mark unread: Listing access lost" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Open listing for Listing access lost" })
    ).toHaveAttribute("href", `/listings/${LOCATION}`)
  })
})

describe("NotificationsView interactions", () => {
  const second = item({
    id: "33333333-3333-4333-8333-333333333333",
    kind: "listing_access_lost",
  })

  it("keeps the filter in the URL and reads it back", async () => {
    const calls = stub(() => ({
      items: [item({})],
      nextCursor: null,
      unreadCount: 1,
    }))
    const first = renderView()
    await screen.findByText("Publishing failed")
    fireEvent.click(screen.getByRole("tab", { name: "Unread" }))
    expect(nav.search).toBe("filter=unread")
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("filter=unread"))).toBe(
        true
      )
    )
    first.unmount()
    renderView()
    expect(await screen.findByRole("tab", { name: "Unread" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    fireEvent.click(screen.getByRole("tab", { name: "All" }))
    expect(nav.search).toBe("")
  })

  it("cancels a resolve without sending it", async () => {
    const calls = stub(() => ({
      items: [item({})],
      nextCursor: null,
      unreadCount: 1,
    }))
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve: Publishing failed" })
    )
    expect(
      screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
    ).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(
      screen.getByRole("button", { name: "Resolve: Publishing failed" })
    ).toBeInTheDocument()
    expect(calls.some((call) => call.url.includes("/resolve"))).toBe(false)
  })

  it("draws the actions as new buttons after the question, never the question's", async () => {
    stub(() => ({ items: [item({})], nextCursor: null, unreadCount: 1 }))
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve: Publishing failed" })
    )
    const questionButtons = screen
      .getByRole("group", { name: "Resolve Publishing failed?" })
      .querySelectorAll("button")
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    // A reused node would carry the green confirm button's colour into a
    // ghost action mid transition (axe caught it in e2e).
    const actions = screen.getAllByRole("button")
    for (const button of questionButtons) {
      expect(actions).not.toContain(button)
    }
  })

  it("shows Mark unread at once and leaves every other control live", async () => {
    const { calls, release } = notificationServer({
      items: [item({}), second],
      hold: "read",
    })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Mark read: Publishing failed",
      })
    )
    // The request is still out, yet the row and the count already say read.
    expect(
      await screen.findByRole("button", {
        name: "Mark unread: Publishing failed",
      })
    ).toBeEnabled()
    expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")
    expect(
      screen.getByRole("button", { name: "Mark read: Listing access lost" })
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: "Resolve: Listing access lost" })
    ).toBeEnabled()
    await waitFor(() => expect(readCalls(calls)).toHaveLength(1))
    release()
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")
    )
    expect(
      screen.getByRole("button", { name: "Mark unread: Publishing failed" })
    ).toBeInTheDocument()
  })

  it("resolves at once after the question, before the server answers", async () => {
    const { calls, release } = notificationServer({
      items: [item({})],
      hold: "resolve",
    })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve: Publishing failed" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
    )
    // The question is gone and the row says Resolved while the request is out.
    expect(await screen.findByText("Resolved")).toBeInTheDocument()
    expect(
      screen.queryByRole("group", { name: "Resolve Publishing failed?" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Resolve: / })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("0 open and unread")
    await waitFor(() =>
      expect(
        calls.filter((call) => call.url.includes("/resolve"))
      ).toHaveLength(1)
    )
    release()
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("0 open and unread")
    )
    expect(screen.getByText("Resolved")).toBeInTheDocument()
  })

  it("puts a refused read back and says so in a toast, with no inline alert", async () => {
    notificationServer({ items: [item({})], fail: "read" })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Mark read: Publishing failed",
      })
    )
    expect(
      await screen.findByText("Your change wasn’t saved")
    ).toBeInTheDocument()
    // Rolled back: the row is unread again and the count is the server's.
    expect(
      await screen.findByRole("button", {
        name: "Mark read: Publishing failed",
      })
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")
    expect(document.body.textContent).not.toMatch(/relation/)
    // The failure is said by the toast, not by a line above the list.
    expect(document.querySelector("p.text-danger-ink[role='alert']")).toBeNull()
  })

  it("puts a refused resolve back, with the Resolve action again", async () => {
    notificationServer({ items: [item({})], fail: "resolve" })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve: Publishing failed" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
    )
    expect(
      await screen.findByText("The notification wasn’t resolved")
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "Resolve: Publishing failed" })
    ).toBeInTheDocument()
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")
  })

  it("keeps a resolve showing while another change settles", async () => {
    const { calls, release } = notificationServer({
      items: [item({}), second],
      hold: "resolve",
    })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve: Publishing failed" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
    )
    await screen.findByText("Resolved")
    fireEvent.click(
      screen.getByRole("button", { name: "Mark read: Listing access lost" })
    )
    expect(
      await screen.findByRole("button", {
        name: "Mark unread: Listing access lost",
      })
    ).toBeInTheDocument()
    // Time for a refetch from the read to land, were it to run too early.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.getByText("Resolved")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Resolve: Publishing failed" })
    ).not.toBeInTheDocument()
    release()
    await waitFor(() => expect(readCalls(calls)).toHaveLength(1))
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("0 open and unread")
    )
    expect(screen.getByText("Resolved")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Mark unread: Listing access lost" })
    ).toBeInTheDocument()
    expect(
      screen.queryByText("The notification wasn’t resolved")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("Your change wasn’t saved")
    ).not.toBeInTheDocument()
  })

  it("takes a row out of the Unread filter the moment it is read", async () => {
    nav.set("filter=unread")
    const { release } = notificationServer({
      items: [item({}), second],
      hold: "read",
    })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Mark read: Publishing failed",
      })
    )
    await waitFor(() =>
      expect(screen.queryByText("Publishing failed")).not.toBeInTheDocument()
    )
    expect(screen.getByText("Listing access lost")).toBeInTheDocument()
    release()
  })

  it("takes a resolved row out of the Open filter at once", async () => {
    nav.set("filter=open")
    const { release } = notificationServer({
      items: [item({}), second],
      hold: "resolve",
    })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve: Publishing failed" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
    )
    await waitFor(() =>
      expect(screen.queryByText("Publishing failed")).not.toBeInTheDocument()
    )
    release()
  })
})

describe("NotificationsView Mark all read", () => {
  it("says how many Mark N shown as read covers while more notifications are still to load", async () => {
    notificationServer({ items: [item({})], nextCursor: "next" })
    renderView()
    expect(
      await screen.findByRole("button", { name: "Mark 1 shown as read" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Mark all read" })
    ).not.toBeInTheDocument()
  })

  it("keeps what saved and says so when a later batch is refused", async () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      item({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })
    )
    const { calls } = notificationServer({ items: many, failReadAfter: 1 })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" })
    )
    expect(
      await screen.findByText("Some notifications weren’t marked as read")
    ).toBeInTheDocument()
    expect(readCalls(calls)).toHaveLength(2)
    // The hundred that saved stay read; only the one that failed is unread.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")
    )
    expect(screen.getAllByText(/\(unread\)/)).toHaveLength(1)
    expect(
      screen.queryByText("Your change wasn’t saved")
    ).not.toBeInTheDocument()
  })

  const read = item({
    id: "44444444-4444-4444-8444-444444444444",
    kind: "listing_access_lost",
    readAt: "2026-09-30T11:00:00.000Z",
  })

  it("reads every unread row shown in one request, then goes", async () => {
    const second = item({
      id: "33333333-3333-4333-8333-333333333333",
      kind: "schedule_missed",
    })
    const { calls, release } = notificationServer({
      items: [item({}), second, read],
      hold: "read",
    })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" })
    )
    await waitFor(() => expect(readCalls(calls)).toHaveLength(1))
    expect(readCalls(calls)[0]?.body).toEqual({
      incidentIds: [item({}).id, second.id],
      read: true,
    })
    // Before the server answers: nothing left to mark, so the button is gone.
    expect(
      screen.queryByRole("button", { name: "Mark all read" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("0 open and unread")
    expect(screen.queryByText(/\(unread\)/)).not.toBeInTheDocument()
    release()
  })

  it("says how many Mark N shown as read covers under Open, which leaves resolved unread rows out", async () => {
    const resolvedUnread = item({
      id: "55555555-5555-4555-8555-555555555555",
      kind: "listing_access_lost",
      status: "resolved",
      resolvedAt: "2026-09-30T12:00:00.000Z",
    })
    const { calls } = notificationServer({ items: [item({}), resolvedUnread] })
    renderView()
    // End of the list under All: everything unread is in it.
    expect(
      await screen.findByRole("button", { name: "Mark all read" })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "Open" }))
    // Under Open the resolved one is not shown, so "all" would be untrue.
    expect(
      await screen.findByRole("button", { name: "Mark 1 shown as read" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Mark all read" })
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Mark 1 shown as read" })
    )
    await waitFor(() => expect(readCalls(calls)).toHaveLength(1))
    expect(readCalls(calls)[0]?.body).toEqual({
      incidentIds: [item({}).id],
      read: true,
    })
  })

  it("is hidden when nothing shown is unread", async () => {
    notificationServer({ items: [read] })
    renderView()
    await screen.findByText("Listing access lost")
    expect(
      screen.queryByRole("button", { name: "Mark all read" })
    ).not.toBeInTheDocument()
  })

  it("sends more than a hundred rows in turns of a hundred", async () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      item({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })
    )
    const { calls } = notificationServer({ items: many })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" })
    )
    await waitFor(() => expect(readCalls(calls)).toHaveLength(2))
    expect(
      readCalls(calls).map(
        (call) => (call.body as { incidentIds: string[] }).incidentIds.length
      )
    ).toEqual([100, 1])
  })

  it("rolls every row back, with a toast, when the server refuses", async () => {
    notificationServer({ items: [item({})], fail: "read" })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" })
    )
    expect(
      await screen.findByText("Your change wasn’t saved")
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "Mark all read" })
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("1 open and unread")
  })
})

describe("NotificationsView rows and empty states", () => {
  it("says unread with weight, a dot and a word, and read in the regular weight", async () => {
    stub(() => ({
      items: [
        item({}),
        item({
          id: "44444444-4444-4444-8444-444444444444",
          kind: "listing_access_lost",
          readAt: "2026-09-30T11:00:00.000Z",
        }),
      ],
      nextCursor: null,
      unreadCount: 1,
    }))
    renderView()
    // ListRow: the title carries the weight; its line adds the dot and the
    // sr-only word after it.
    const unreadTitle = await screen.findByText("Publishing failed")
    expect(unreadTitle).toHaveClass("font-semibold", "text-ink")
    // The word is there for assistive technology; the dot only reinforces it.
    expect(unreadTitle.parentElement).toHaveTextContent(
      "Publishing failed, (unread)"
    )
    expect(
      unreadTitle.parentElement!.querySelector(
        '[data-slot="list-row-unread-dot"]'
      )
    ).toHaveAttribute("aria-hidden")
    const readTitle = screen.getByText("Listing access lost")
    expect(readTitle).toHaveClass("font-normal", "text-ink-secondary")
    expect(readTitle).not.toHaveClass("font-semibold")
    expect(readTitle.parentElement).not.toHaveTextContent("(unread)")
    expect(
      readTitle.parentElement!.querySelector(
        '[data-slot="list-row-unread-dot"]'
      )
    ).toBeNull()
    expect(screen.getAllByText(/\(unread\)/)).toHaveLength(1)
    expect(screen.getAllByText(/\(unread\)/)[0]).toHaveClass("sr-only")
    // No row tint: unread is weight and the dot, not a background.
    for (const row of screen.getAllByRole("listitem"))
      expect(row).not.toHaveClass("bg-surface-alt")
  })

  it("titles the page once, with the open-and-unread count after it", async () => {
    stub(() => ({ items: [item({})], nextCursor: null, unreadCount: 3 }))
    renderView()
    await screen.findByText("Publishing failed")
    const headings = screen.getAllByRole("heading", { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent("Notifications")
    const count = document.querySelector('[data-slot="view-header-count"]')
    // Seen: the figure. Heard: the number with its words (R2b P1-S2), never
    // the words alone.
    expect(count?.querySelector("[aria-hidden]")).toHaveTextContent(/^3$/)
    expect(count?.querySelector(".sr-only")).toHaveTextContent(
      /\b3 open and unread\b/
    )
    expect(
      screen.getByRole("link", { name: "Notification settings" })
    ).toHaveAttribute("href", "/settings/notifications")
    // The row is not a control: its actions are the buttons.
    expect(document.querySelector('[data-slot="list-row-hit"]')?.tagName).toBe(
      "DIV"
    )
  })

  it("says why the list is empty and what will appear", async () => {
    stub(() => ({ items: [], nextCursor: null, unreadCount: 0 }))
    renderView()
    expect(
      await screen.findByRole("heading", { name: "No notifications yet" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Problems with Google connections, publishing and syncs/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Show all notifications" })
    ).not.toBeInTheDocument()
    // The next step: where to choose what appears here (the header's link
    // and the empty state's own action).
    const settings = screen.getAllByRole("link", {
      name: "Notification settings",
    })
    expect(settings).toHaveLength(2)
    for (const link of settings)
      expect(link).toHaveAttribute("href", "/settings/notifications")
    expect(
      screen.queryByRole("button", { name: "Mark all read" })
    ).not.toBeInTheDocument()
  })

  it("offers All from an empty filtered view", async () => {
    nav.set("filter=unread")
    const calls = stub(() => ({ items: [], nextCursor: null, unreadCount: 0 }))
    renderView()
    expect(
      await screen.findByRole("heading", {
        name: "Nothing matches this filter",
      })
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "Show all notifications" })
    )
    expect(nav.search).toBe("")
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.url.includes("/api/notifications") &&
            call.url.includes("filter=all")
        )
      ).toBe(true)
    )
  })
})

/**
 * A server the test steps by hand. A read or resolve waits for the test to
 * `accept()` or `refuse()` it; the lists answer at once unless `holdLists()`
 * keeps them back (a reconciliation GET the test wants to see the screen
 * without). Requests are numbered in the order they reach the server.
 */
type Write = {
  call: Call
  accept: (updated?: number) => void
  refuse: (status?: number) => void
}
function steppedServer(initial: (Record<string, unknown> & { id: string })[]) {
  let state = initial
  let gate: Promise<void> | null = null
  let openGate = () => {}
  let listsFail = false
  const calls: Call[] = []
  const writes: Write[] = []
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = {
        url: String(url),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      }
      calls.push(call)
      if (call.method === "GET") {
        if (gate) await gate
        if (listsFail)
          return json(
            { error: "internal_error", message: "Something broke." },
            500
          )
        const filter = new URL(call.url, "http://x").searchParams.get("filter")
        return json({
          items: state.filter((row) =>
            filter === "unread"
              ? !row.readAt
              : filter === "open"
                ? row.status === "open"
                : true
          ),
          nextCursor: null,
          unreadCount: state.filter(
            (row) => row.status === "open" && !row.readAt
          ).length,
        })
      }
      return new Promise<Response>((resolve) => {
        writes.push({
          call,
          accept: (updated?: number) => {
            if (call.url.endsWith("/api/notifications/read")) {
              const { incidentIds, read } = call.body as {
                incidentIds: string[]
                read: boolean
              }
              // `updated` below the batch: the server dropped some ids (and,
              // at 0, all of them) without telling which.
              if (updated !== 0)
                state = state.map((row) =>
                  incidentIds.includes(row.id)
                    ? {
                        ...row,
                        readAt: read ? "2026-10-01T09:00:00.000Z" : null,
                      }
                    : row
                )
              resolve(json({ updated: updated ?? incidentIds.length }))
              return
            }
            state = state.map((row) =>
              call.url.includes(row.id)
                ? {
                    ...row,
                    status: "resolved",
                    resolvedAt: "2026-10-01T09:00:00.000Z",
                    canResolve: false,
                  }
                : row
            )
            resolve(json({ resolved: true }))
          },
          refuse: (status = 500) =>
            resolve(
              json(
                {
                  error:
                    status === 403 ? "permission_denied" : "internal_error",
                  message: "Refused.",
                },
                status
              )
            ),
        })
      })
    })
  )
  return {
    calls,
    writes,
    /** The nth request that changes something, once it has reached the server. */
    write: async (index: number) => {
      await waitFor(() => expect(writes.length).toBeGreaterThan(index))
      return writes[index]!
    },
    /** What the server holds from now on (for example another scope's rows). */
    set: (next: typeof initial) => void (state = next),
    /** Every list request from now on is answered with a server error. */
    failLists: () => void (listsFail = true),
    holdLists: () => {
      gate = new Promise<void>((resolve) => (openGate = resolve))
    },
    releaseLists: () => {
      gate = null
      openGate()
    },
    listCalls: (filter: string) =>
      calls.filter(
        (call) => call.method === "GET" && call.url.includes(`filter=${filter}`)
      ).length,
  }
}

const OWNER: SessionUser = {
  userId: "u1",
  organisationId: "o1",
  organisationName: "Organisation",
  displayName: "Person",
  email: "person@example.com",
  role: "owner",
  canPublish: true,
  workspaceMode: "business",
  scopeFingerprint: "fp-owner",
}
const MEMBER: SessionUser = {
  ...OWNER,
  role: "member",
  canPublish: false,
  scopeFingerprint: "fp-member",
}
/** The app's own scope reset (the provider's hook) around the real view. */
function ScopedApp({
  client,
  bell = false,
}: {
  client: QueryClient
  bell?: boolean
}) {
  useScopeReset(client)
  return (
    <QueryClientProvider client={client}>
      <Toaster>
        {bell ? <NotificationsLink /> : null}
        <NotificationsView />
      </Toaster>
    </QueryClientProvider>
  )
}
function mountScoped(session: SessionUser = OWNER, bell = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData<SessionResponse>(queryKeys.session, { session })
  render(<ScopedApp client={client} bell={bell} />)
  return client
}
const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))
const count = () => screen.getByRole("status")
const bell = () => screen.getByRole("link", { name: /^Notifications/ })

describe("NotificationsView pending changes", () => {
  const first = item({})
  const other = item({
    id: "33333333-3333-4333-8333-333333333333",
    kind: "listing_access_lost",
  })

  describe("when the session scope changes under a change", () => {
    it("never brings an owner's incident back for a member when a resolve is refused late", async () => {
      const server = steppedServer([first])
      const client = mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Resolve: Publishing failed",
        })
      )
      fireEvent.click(
        screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
      )
      expect(await screen.findByText("Resolved")).toBeInTheDocument()
      const write = await server.write(0)
      // The person's role changes: the member's scope sees no incident, and
      // the reconciliation GET for it is held.
      server.set([])
      server.holdLists()
      await act(async () => {
        client.setQueryData<SessionResponse>(queryKeys.session, {
          session: MEMBER,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      // The scope reset has run: nothing of the owner's is on screen.
      await waitFor(() =>
        expect(screen.queryByText("Publishing failed")).not.toBeInTheDocument()
      )
      write.refuse(403)
      expect(
        await screen.findByText("The notification wasn’t resolved")
      ).toBeInTheDocument()
      await tick()
      // Nothing from the old scope is put back while the GET is out.
      expect(screen.queryByText("Publishing failed")).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /^Resolve: / })
      ).not.toBeInTheDocument()
      server.releaseLists()
      expect(
        await screen.findByRole("heading", { name: "No notifications yet" })
      ).toBeInTheDocument()
      expect(screen.queryByText("Publishing failed")).not.toBeInTheDocument()
    })

    it("never brings another organisation's row back when a read is refused late", async () => {
      const server = steppedServer([first])
      const client = mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Mark read: Publishing failed",
        })
      )
      await screen.findByRole("button", {
        name: "Mark unread: Publishing failed",
      })
      const write = await server.write(0)
      server.set([other])
      server.holdLists()
      await act(async () => {
        client.setQueryData<SessionResponse>(queryKeys.session, {
          session: {
            ...OWNER,
            organisationId: "o2",
            scopeFingerprint: "fp-o2",
          },
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      write.refuse(403)
      expect(
        await screen.findByText("Your change wasn’t saved")
      ).toBeInTheDocument()
      await tick()
      expect(screen.queryByText("Publishing failed")).not.toBeInTheDocument()
      server.releaseLists()
      expect(await screen.findByText("Listing access lost")).toBeInTheDocument()
      // The other organisation's row is its own, unread, and not touched by
      // the old read.
      expect(
        screen.getByRole("button", { name: "Mark read: Listing access lost" })
      ).toBeInTheDocument()
      expect(count()).toHaveTextContent("1 open and unread")
    })

    it("does not apply an accepted change from the old scope to the new scope's rows", async () => {
      const server = steppedServer([first])
      const client = mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Mark read: Publishing failed",
        })
      )
      const write = await server.write(0)
      // The same incident id, unread, in the scope the session moves to.
      server.set([first])
      await act(async () => {
        client.setQueryData<SessionResponse>(queryKeys.session, {
          session: MEMBER,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await screen.findByText("Publishing failed")
      server.holdLists()
      const reconciles = server.listCalls("all")
      write.accept()
      // The reconciliation GET has gone out (and is held): the change has
      // been handled, and what shows is what the cache holds.
      await waitFor(() =>
        expect(server.listCalls("all")).toBeGreaterThan(reconciles)
      )
      await tick()
      // Not committed: the member's row is still unread.
      expect(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      ).toBeInTheDocument()
      expect(count()).toHaveTextContent("1 open and unread")
      expect(
        client.getQueryData<{
          pages: { items: { readAt: string | null }[] }[]
        }>(queryKeys.notifications("all"))?.pages[0]?.items[0]?.readAt
      ).toBeNull()
      server.releaseLists()
    })

    it("does not commit a change the scope dropped, even when the scope comes back", async () => {
      const server = steppedServer([first])
      const client = mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Mark read: Publishing failed",
        })
      )
      await screen.findByRole("button", {
        name: "Mark unread: Publishing failed",
      })
      const write = await server.write(0)
      // Owner, then member, then the owner's scope again: the token is the
      // same as when the change was made, but the change is not the owner's
      // second stretch's.
      for (const session of [MEMBER, OWNER])
        await act(async () => {
          client.setQueryData<SessionResponse>(queryKeys.session, { session })
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
      expect(
        await screen.findByRole("button", {
          name: "Mark read: Publishing failed",
        })
      ).toBeInTheDocument()
      server.holdLists()
      const reconciles = server.listCalls("all")
      write.accept()
      await waitFor(() =>
        expect(server.listCalls("all")).toBeGreaterThan(reconciles)
      )
      await tick()
      // Gone from the store (the row shows what the cache holds) and not
      // written into the cache.
      expect(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      ).toBeInTheDocument()
      expect(count()).toHaveTextContent("1 open and unread")
      const cached = client.getQueryData<{
        pages: { items: { readAt: string | null }[]; unreadCount: number }[]
      }>(queryKeys.notifications("all"))
      expect(cached?.pages[0]?.items[0]?.readAt).toBeNull()
      expect(cached?.pages[0]?.unreadCount).toBe(1)
      server.releaseLists()
    })
  })

  describe("when a queued change loses its scope before it is sent", () => {
    it("sends nothing for it, and says nothing, once the earlier change settles", async () => {
      const server = steppedServer([first, other])
      const client = mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Resolve: Publishing failed",
        })
      )
      fireEvent.click(
        screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
      )
      const resolve = await server.write(0)
      // Queued behind the resolve, which is still in flight.
      fireEvent.click(
        screen.getByRole("button", { name: "Mark read: Listing access lost" })
      )
      await tick()
      expect(server.writes).toHaveLength(1)
      // The person's role changes: the scope reset drops the queued change.
      await act(async () => {
        client.setQueryData<SessionResponse>(queryKeys.session, {
          session: MEMBER,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      resolve.accept()
      await waitFor(() => expect(server.listCalls("all")).toBeGreaterThan(1))
      await tick()
      // The dropped change never reached the server, and it did not fail
      // aloud for a row the person can no longer see.
      expect(server.writes).toHaveLength(1)
      expect(screen.queryByText("Your change wasn’t saved")).toBeNull()
    })
  })

  describe("when the scope moves between the turns of one change", () => {
    it("sends no later turn once the scope has dropped the change", async () => {
      const many = Array.from({ length: 101 }, (_, index) =>
        item({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        })
      )
      const server = steppedServer(many)
      const client = mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", { name: "Mark all read" })
      )
      const turnOne = await server.write(0)
      // The role changes while turn one is in flight: the change is dropped.
      await act(async () => {
        client.setQueryData<SessionResponse>(queryKeys.session, {
          session: MEMBER,
        })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      turnOne.accept()
      await waitFor(() => expect(server.listCalls("all")).toBeGreaterThan(1))
      await tick()
      // Turn two (the 101st row) never went out.
      expect(server.writes).toHaveLength(1)
    })

    // A different person, and A→B→A back to the original scope: the change
    // was dropped when the scope left, so coming back does not revive it.
    const OTHER_USER: SessionUser = {
      ...OWNER,
      userId: "u2",
      email: "other@example.com",
      scopeFingerprint: "fp-other",
    }
    async function markAll101Through(moves: SessionUser[]) {
      const many = Array.from({ length: 101 }, (_, index) =>
        item({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        })
      )
      const server = steppedServer(many)
      const client = mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", { name: "Mark all read" })
      )
      const turnOne = await server.write(0)
      for (const session of moves) {
        await act(async () => {
          client.setQueryData<SessionResponse>(queryKeys.session, { session })
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
      }
      turnOne.accept()
      await waitFor(() => expect(server.listCalls("all")).toBeGreaterThan(1))
      await tick()
      return server
    }

    it("sends no later turn when another user takes over mid-change", async () => {
      const server = await markAll101Through([OTHER_USER])
      expect(server.writes).toHaveLength(1)
    })

    it("sends no later turn when the scope goes A→B→A mid-change", async () => {
      const server = await markAll101Through([MEMBER, OWNER])
      expect(server.writes).toHaveLength(1)
    })
  })

  describe("when changes overlap", () => {
    it("takes back only the refused change, then the other, in either order", async () => {
      const server = steppedServer([first, other])
      renderView()
      await screen.findByText("Publishing failed")
      fireEvent.click(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      )
      const a = await server.write(0)
      // Mark all read now covers only what is still unread: the other row.
      fireEvent.click(screen.getByRole("button", { name: "Mark all read" }))
      expect(
        screen.getByRole("button", { name: "Mark unread: Publishing failed" })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Mark unread: Listing access lost" })
      ).toBeInTheDocument()
      expect(count()).toHaveTextContent("0 open and unread")
      server.holdLists()
      a.refuse()
      // A is unread again; B, whose request has not been sent, still shows read.
      expect(
        await screen.findByRole("button", {
          name: "Mark read: Publishing failed",
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Mark unread: Listing access lost" })
      ).toBeInTheDocument()
      expect(count()).toHaveTextContent("1 open and unread")
      const b = await server.write(1)
      expect(b.call.body).toEqual({ incidentIds: [other.id], read: true })
      b.refuse()
      await waitFor(() =>
        expect(count()).toHaveTextContent("2 open and unread")
      )
      expect(screen.getAllByText(/\(unread\)/)).toHaveLength(2)
      server.releaseLists()
    })

    it("keeps the one that saved when the other is refused, either way round", async () => {
      for (const [firstFails, secondFails] of [
        [false, true],
        [true, false],
      ] as const) {
        const server = steppedServer([first, other])
        const view = renderView()
        await screen.findByText("Publishing failed")
        fireEvent.click(
          screen.getByRole("button", { name: "Mark read: Publishing failed" })
        )
        const a = await server.write(0)
        fireEvent.click(screen.getByRole("button", { name: "Mark all read" }))
        server.holdLists()
        if (firstFails) a.refuse()
        else a.accept()
        const b = await server.write(1)
        // What is on screen between the two answers.
        await waitFor(() =>
          expect(count()).toHaveTextContent(
            firstFails ? "1 open and unread" : "0 open and unread"
          )
        )
        expect(
          screen.getByRole("button", {
            name: firstFails
              ? "Mark read: Publishing failed"
              : "Mark unread: Publishing failed",
          })
        ).toBeInTheDocument()
        if (secondFails) b.refuse()
        else b.accept()
        await waitFor(() =>
          expect(count()).toHaveTextContent("1 open and unread")
        )
        // Exactly one of the two is unread, and it is the one that failed.
        expect(
          screen.getByRole("button", {
            name: firstFails
              ? "Mark read: Publishing failed"
              : "Mark read: Listing access lost",
          })
        ).toBeInTheDocument()
        expect(
          screen.getByRole("button", {
            name: firstFails
              ? "Mark unread: Listing access lost"
              : "Mark unread: Publishing failed",
          })
        ).toBeInTheDocument()
        server.releaseLists()
        view.unmount()
        vi.unstubAllGlobals()
      }
    })
  })

  it("keeps a pending resolve out of the Open filter when a read in All settles", async () => {
    const server = steppedServer([first, other])
    const client = mountScoped(OWNER)
    await screen.findByText("Publishing failed")
    fireEvent.click(
      screen.getByRole("button", { name: "Mark read: Publishing failed" })
    )
    const read = await server.write(0)
    // Switch to Open (another cached list) and resolve the other incident.
    fireEvent.click(screen.getByRole("tab", { name: "Open" }))
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Resolve: Listing access lost",
      })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, resolve: Listing access lost" })
    )
    await waitFor(() =>
      expect(screen.queryByText("Listing access lost")).not.toBeInTheDocument()
    )
    const opens = server.listCalls("open")
    read.accept()
    // The read settles and every list is refetched; the Open refetch comes
    // back with the incident still open, because its resolve is still queued.
    const resolve = await server.write(1)
    expect(resolve.call.url).toContain(other.id)
    await waitFor(() => expect(server.listCalls("open")).toBeGreaterThan(opens))
    // The refetch has come back and been rendered (nothing is still
    // fetching, and the screen has caught up with the cache).
    await waitFor(() =>
      expect(client.isFetching({ queryKey: queryKeys.notificationsAll })).toBe(
        0
      )
    )
    await tick()
    expect(screen.queryByText("Listing access lost")).not.toBeInTheDocument()
    expect(screen.getByText("Publishing failed")).toBeInTheDocument()
    expect(count()).toHaveTextContent("0 open and unread")
    resolve.accept()
    await waitFor(() => expect(count()).toHaveTextContent("0 open and unread"))
    expect(screen.queryByText("Listing access lost")).not.toBeInTheDocument()
  })

  it("keeps the saved turns read, with no flash of unread, when a later turn is refused", async () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      item({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })
    )
    const server = steppedServer(many)
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all read" })
    )
    const turnOne = await server.write(0)
    expect(
      (turnOne.call.body as { incidentIds: string[] }).incidentIds
    ).toHaveLength(100)
    server.holdLists()
    turnOne.accept()
    const turnTwo = await server.write(1)
    turnTwo.refuse()
    expect(
      await screen.findByText("Some notifications weren’t marked as read")
    ).toBeInTheDocument()
    // With the reconciliation GET still out: the hundred that saved are read
    // from the cache, and the one that was refused is the only unread row.
    expect(count()).toHaveTextContent("1 open and unread")
    expect(screen.getAllByText(/\(unread\)/)).toHaveLength(1)
    server.releaseLists()
    await waitFor(() => expect(count()).toHaveTextContent("1 open and unread"))
    expect(screen.getAllByText(/\(unread\)/)).toHaveLength(1)
  })

  describe("the shell bell", () => {
    const bellName = (unread: number) =>
      unread ? `Notifications, ${unread} unread` : "Notifications"
    const agree = (unread: number) => {
      expect(count()).toHaveTextContent(`${unread} open and unread`)
      expect(bell()).toHaveAccessibleName(bellName(unread))
    }

    it("agrees with the page count while a read, a resolve and Mark all read are pending, and rolls back with them", async () => {
      const server = steppedServer([first, other])
      mountScoped(OWNER, true)
      await screen.findByText("Publishing failed")
      await waitFor(() => agree(2))
      // A read.
      fireEvent.click(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      )
      agree(1)
      // A resolve of the other incident.
      fireEvent.click(
        screen.getByRole("button", { name: "Resolve: Listing access lost" })
      )
      fireEvent.click(
        screen.getByRole("button", {
          name: "Yes, resolve: Listing access lost",
        })
      )
      agree(0)
      // Both refused: both back, together.
      server.holdLists()
      ;(await server.write(0)).refuse()
      await waitFor(() => agree(1))
      ;(await server.write(1)).refuse()
      await waitFor(() => agree(2))
      expect(screen.getAllByText(/\(unread\)/)).toHaveLength(2)
      // Mark all read, then refused.
      fireEvent.click(screen.getByRole("button", { name: "Mark all read" }))
      agree(0)
      ;(await server.write(2)).refuse()
      await waitFor(() => agree(2))
      server.releaseLists()
    })

    it("holds the committed value in the badge cache once a change is accepted", async () => {
      const server = steppedServer([first, other])
      const client = mountScoped(OWNER, true)
      await screen.findByText("Publishing failed")
      await waitFor(() => agree(2))
      fireEvent.click(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      )
      agree(1)
      // The reconciliation GET is held: what shows is the committed cache.
      server.holdLists()
      ;(await server.write(0)).accept()
      await waitFor(() =>
        expect(
          client.getQueryData<{ unreadCount: number }>(
            queryKeys.notifications("badge")
          )?.unreadCount
        ).toBe(1)
      )
      await tick()
      // Neither double counted nor dropped to zero.
      agree(1)
      fireEvent.click(
        screen.getByRole("button", { name: "Resolve: Listing access lost" })
      )
      fireEvent.click(
        screen.getByRole("button", {
          name: "Yes, resolve: Listing access lost",
        })
      )
      agree(0)
      ;(await server.write(1)).accept()
      await waitFor(() =>
        expect(
          client.getQueryData<{ unreadCount: number }>(
            queryKeys.notifications("badge")
          )?.unreadCount
        ).toBe(0)
      )
      await tick()
      agree(0)
      server.releaseLists()
      await waitFor(() => agree(0))
    })

    it("does not take a saved read off the badge twice when a poll has already seen it", async () => {
      const server = steppedServer([first, other])
      const client = mountScoped(OWNER, true)
      await screen.findByText("Publishing failed")
      await waitFor(() => agree(2))
      fireEvent.click(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      )
      agree(1)
      // A shell poll that went out after the save reaches the server answers
      // before the change's own response does: the unread page it brings
      // (read to its end) no longer holds the incident, and its count is 1.
      // The list the page shows still holds the incident as unread.
      act(() => {
        seedShellKeys(client, {
          counts: {},
          connections: [],
          notifications: {
            items: [other],
            nextCursor: null,
            unreadCount: 1,
          },
        } as unknown as ShellStatusResponse)
      })
      // The count already has the read: neither the bell nor the page takes
      // it off again. (The cache's notifications are deferred: let the bell
      // see the poll before it is judged.)
      await tick()
      agree(1)
      server.holdLists()
      ;(await server.write(0)).accept()
      await waitFor(() =>
        expect(count()).toHaveTextContent("1 open and unread")
      )
      await tick()
      expect(
        client.getQueryData<{ unreadCount: number }>(
          queryKeys.notifications("badge")
        )?.unreadCount
      ).toBe(1)
      agree(1)
      server.releaseLists()
      await waitFor(() => agree(1))
    })

    describe("when the opposite change on the same row is refused after the first is saved", () => {
      const badgeOf = (client: QueryClient) =>
        client.getQueryData<{ unreadCount: number }>(
          queryKeys.notifications("badge")
        )?.unreadCount

      it("leaves page, bell and badge cache at the saved read", async () => {
        const server = steppedServer([first, other])
        const client = mountScoped(OWNER, true)
        await screen.findByText("Publishing failed")
        await waitFor(() => agree(2))
        fireEvent.click(
          screen.getByRole("button", { name: "Mark read: Publishing failed" })
        )
        fireEvent.click(
          screen.getByRole("button", { name: "Mark unread: Publishing failed" })
        )
        agree(2)
        server.holdLists()
        ;(await server.write(0)).accept()
        await waitFor(() => expect(badgeOf(client)).toBe(1))
        ;(await server.write(1)).refuse()
        await waitFor(() => agree(1))
        await tick()
        expect(badgeOf(client)).toBe(1)
        agree(1)
        server.releaseLists()
        await waitFor(() => agree(1))
      })

      it("leaves page, bell and badge cache at the saved unread", async () => {
        const server = steppedServer([{ ...first, readAt: READ_AT }, other])
        const client = mountScoped(OWNER, true)
        await screen.findByText("Publishing failed")
        await waitFor(() => agree(1))
        fireEvent.click(
          screen.getByRole("button", { name: "Mark unread: Publishing failed" })
        )
        fireEvent.click(
          screen.getByRole("button", { name: "Mark read: Publishing failed" })
        )
        agree(1)
        server.holdLists()
        ;(await server.write(0)).accept()
        await waitFor(() => expect(badgeOf(client)).toBe(2))
        ;(await server.write(1)).refuse()
        await waitFor(() => agree(2))
        await tick()
        expect(badgeOf(client)).toBe(2)
        agree(2)
        server.releaseLists()
        await waitFor(() => agree(2))
      })

      it("holds when both opposite changes save", async () => {
        const both = steppedServer([first, other])
        const client = mountScoped(OWNER, true)
        await screen.findByText("Publishing failed")
        await waitFor(() => agree(2))
        fireEvent.click(
          screen.getByRole("button", { name: "Mark read: Publishing failed" })
        )
        fireEvent.click(
          screen.getByRole("button", { name: "Mark unread: Publishing failed" })
        )
        both.holdLists()
        ;(await both.write(0)).accept()
        await waitFor(() => expect(badgeOf(client)).toBe(1))
        ;(await both.write(1)).accept()
        await waitFor(() => expect(badgeOf(client)).toBe(2))
        agree(2)
        both.releaseLists()
        await waitFor(() => agree(2))
      })

      it("holds when the first is refused and the second saved", async () => {
        const server = steppedServer([first, other])
        const client = mountScoped(OWNER, true)
        await screen.findByText("Publishing failed")
        await waitFor(() => agree(2))
        fireEvent.click(
          screen.getByRole("button", { name: "Mark read: Publishing failed" })
        )
        fireEvent.click(
          screen.getByRole("button", { name: "Mark unread: Publishing failed" })
        )
        server.holdLists()
        ;(await server.write(0)).refuse()
        ;(await server.write(1)).accept()
        await waitFor(() => agree(2))
        await tick()
        expect(badgeOf(client)).toBe(2)
        agree(2)
        server.releaseLists()
        await waitFor(() => agree(2))
      })
    })

    describe("when the shell's unread page has more to load", () => {
      // The shell asks for the first 20 unread rows; the person has 22. Rows
      // are newest first, as the server sends them.
      const rows = Array.from({ length: 22 }, (_, index) =>
        item({
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          openedAt: new Date(
            Date.UTC(2026, 8, 30, 10, 0) - index * 60_000
          ).toISOString(),
        })
      )
      const shellPage = (from: number, unreadCount: number) =>
        ({
          counts: {},
          connections: [],
          notifications: {
            items: rows.slice(from, from + 20),
            nextCursor: "more",
            unreadCount,
          },
        }) as unknown as ShellStatusResponse
      const badgeCount = (client: QueryClient) =>
        client.getQueryData<{ unreadCount: number }>(
          queryKeys.notifications("badge")
        )?.unreadCount

      /** Marks the nth still-unread row read, with the badge page loaded. */
      async function markRead(index = 0) {
        const server = steppedServer(rows)
        const client = mountScoped(OWNER, true)
        await waitFor(() => expect(count()).toHaveTextContent("22 open"))
        act(() => seedShellKeys(client, shellPage(0, 22)))
        await tick()
        fireEvent.click(
          screen.getAllByRole("button", {
            name: "Mark read: Publishing failed",
          })[index]!
        )
        agree(21)
        return { server, client }
      }
      const markFirstRead = () => markRead(0)

      it("does not take a saved read off the badge twice when a poll has already seen it", async () => {
        const { server, client } = await markFirstRead()
        // The save has reached the server and its answer is held. A shell
        // poll answers first: the first 20 unread rows without the saved row
        // (the 21st has moved up) and a count that already has the read.
        act(() => seedShellKeys(client, shellPage(1, 21)))
        await tick()
        agree(21)
        server.holdLists()
        ;(await server.write(0)).accept()
        await waitFor(() => expect(badgeCount(client)).toBe(21))
        await tick()
        // Committed before any reconciliation: neither 20 nor 22.
        expect(badgeCount(client)).toBe(21)
        agree(21)
        server.releaseLists()
        await waitFor(() => agree(21))
      })

      it("still takes the read off a count from a poll that left before the save", async () => {
        const { server, client } = await markFirstRead()
        // The poll's page still holds the row as unread: it left before the
        // save reached the server, and its count of 22 does not have the read.
        act(() => seedShellKeys(client, shellPage(0, 22)))
        await tick()
        agree(21)
        server.holdLists()
        ;(await server.write(0)).accept()
        await waitFor(() => expect(badgeCount(client)).toBe(21))
        await tick()
        agree(21)
        server.releaseLists()
        await waitFor(() => agree(21))
      })

      it("does not take a saved read of a row beyond the page off the badge twice", async () => {
        // The oldest row: the page of 20 can never hold it, so whether a poll
        // has already absorbed its read is not in the page at all.
        const { server, client } = await markRead(21)
        act(() => seedShellKeys(client, shellPage(0, 21)))
        await tick()
        agree(21)
        server.holdLists()
        ;(await server.write(0)).accept()
        await waitFor(() => expect(badgeCount(client)).toBe(21))
        await tick()
        expect(badgeCount(client)).toBe(21)
        agree(21)
        server.releaseLists()
        await waitFor(() => agree(21))
      })

      it("still takes a read of a row beyond the page off a count from a poll that left before the save", async () => {
        const { server, client } = await markRead(21)
        act(() => seedShellKeys(client, shellPage(0, 22)))
        await tick()
        agree(21)
        server.holdLists()
        ;(await server.write(0)).accept()
        await waitFor(() => expect(badgeCount(client)).toBe(21))
        await tick()
        agree(21)
        server.releaseLists()
        await waitFor(() => agree(21))
      })

      it("counts a row the badge page left out as already read when a stale page still shows it unread", async () => {
        // The first row was read on another device. The badge page and count
        // have it (21 unread, the row gone), but this page's list is older and
        // still shows it unread. Marking it read here changes nothing in the
        // count the bell holds.
        const server = steppedServer(rows)
        const client = mountScoped(OWNER, true)
        await waitFor(() => expect(count()).toHaveTextContent("22 open"))
        act(() => seedShellKeys(client, shellPage(1, 21)))
        await tick()
        await waitFor(() => expect(bell()).toHaveAccessibleName(bellName(21)))
        fireEvent.click(
          screen.getAllByRole("button", {
            name: "Mark read: Publishing failed",
          })[0]!
        )
        // The page's own count falls (it still held the row as unread); the
        // bell does not.
        expect(count()).toHaveTextContent("21 open and unread")
        expect(bell()).toHaveAccessibleName(bellName(21))
        server.holdLists()
        ;(await server.write(0)).accept()
        await waitFor(() => expect(badgeCount(client)).toBe(21))
        await tick()
        expect(badgeCount(client)).toBe(21)
        expect(bell()).toHaveAccessibleName(bellName(21))
        server.releaseLists()
      })

      it("keeps the bell on the pinned total while one change commits and another is still out", async () => {
        const { server, client } = await markRead(21)
        // A second change, queued behind the first.
        fireEvent.click(
          screen.getAllByRole("button", {
            name: "Mark read: Publishing failed",
          })[0]!
        )
        agree(20)
        // A poll that has absorbed the first only.
        act(() => seedShellKeys(client, shellPage(0, 21)))
        await tick()
        agree(20)
        server.holdLists()
        ;(await server.write(0)).accept()
        // The first is permanent (21); the second still takes one off.
        await waitFor(() => expect(badgeCount(client)).toBe(21))
        await tick()
        agree(20)
        ;(await server.write(1)).accept()
        await waitFor(() => expect(badgeCount(client)).toBe(20))
        await tick()
        agree(20)
        server.releaseLists()
        await waitFor(() => agree(20))
      })

      it("goes back to the count a poll brought when the only change is refused", async () => {
        const { server, client } = await markRead(21)
        act(() => seedShellKeys(client, shellPage(0, 23)))
        await tick()
        agree(21)
        server.holdLists()
        ;(await server.write(0)).refuse()
        // Nothing was saved: the poll's count (a new notification) is the truth.
        await waitFor(() => expect(bell()).toHaveAccessibleName(bellName(23)))
        server.releaseLists()
      })
    })

    it("is not overwritten by a shell poll that left before the change was saved", async () => {
      const server = steppedServer([first, other])
      const client = mountScoped(OWNER, true)
      await screen.findByText("Publishing failed")
      await waitFor(() => agree(2))
      fireEvent.click(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      )
      agree(1)
      // A poll leaves now, still holding the count from before the save. Like
      // the real one it seeds the badge when its answer arrives, and its
      // request is aborted when cancelled.
      let answer = () => {}
      const poll = client.fetchQuery({
        queryKey: queryKeys.shellStatus,
        queryFn: ({ client: queryClient, signal }) =>
          new Promise<null>((resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError"))
            )
            answer = () => {
              // The real poll seeds only after its request resolves, which
              // an abort prevents.
              if (signal.aborted) return
              seedShellKeys(queryClient, {
                counts: {},
                connections: [],
                notifications: { items: [], nextCursor: null, unreadCount: 2 },
              } as unknown as ShellStatusResponse)
              resolve(null)
            }
          }),
      })
      poll.catch(() => undefined)
      server.holdLists()
      ;(await server.write(0)).accept()
      await waitFor(() =>
        expect(
          client.getQueryData<{ unreadCount: number }>(
            queryKeys.notifications("badge")
          )?.unreadCount
        ).toBe(1)
      )
      // The stale poll answers after the commit: it must not land.
      answer()
      await tick()
      expect(
        client.getQueryData<{ unreadCount: number }>(
          queryKeys.notifications("badge")
        )?.unreadCount
      ).toBe(1)
      agree(1)
      server.releaseLists()
    })
  })

  describe("keyboard focus", () => {
    const pressMarkAllRead = async () => {
      const button = await screen.findByRole("button", {
        name: "Mark all read",
      })
      button.focus()
      expect(button).toHaveFocus()
      await userEvent.keyboard("{Enter}")
      return button
    }

    it("stays on the active filter tab when Mark all read goes", async () => {
      const server = steppedServer([first, other])
      renderView()
      const button = await pressMarkAllRead()
      expect(button).not.toBeInTheDocument()
      expect(screen.getByRole("tab", { name: "All" })).toHaveFocus()
      expect(document.activeElement).not.toBe(document.body)
      ;(await server.write(0)).accept()
      await tick()
      expect(screen.getByRole("tab", { name: "All" })).toHaveFocus()
    })

    it("stays there when the request is refused and the button comes back", async () => {
      const server = steppedServer([first, other])
      renderView()
      await pressMarkAllRead()
      ;(await server.write(0)).refuse()
      expect(
        await screen.findByText("Your change wasn’t saved")
      ).toBeInTheDocument()
      expect(
        await screen.findByRole("button", { name: "Mark all read" })
      ).toBeInTheDocument()
      expect(screen.getByRole("tab", { name: "All" })).toHaveFocus()
    })

    it("goes to the tab of the filter being shown", async () => {
      nav.set("filter=unread")
      steppedServer([first, other])
      renderView()
      await pressMarkAllRead()
      expect(screen.getByRole("tab", { name: "Unread" })).toHaveFocus()
    })
  })
})

type Preference = {
  kind: string
  channel: "in_app" | "email"
  mode: "immediate" | "digest" | "off"
  explicit: boolean
}
const pref = (
  kind: string,
  channel: Preference["channel"],
  mode: Preference["mode"]
): Preference => ({ kind, channel, mode, explicit: false })

/**
 * A server that keeps the preferences: a PUT applies its changes (or fails
 * with 422 when `failPut`, or waits for `release()` when `hold`) and every
 * GET returns what it holds.
 */
function preferenceServer({
  emailConfigured,
  preferences,
  failPut = false,
  hold = false,
}: {
  emailConfigured: boolean
  preferences: Preference[]
  failPut?: boolean
  hold?: boolean
}) {
  let state = preferences
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const calls: Call[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = {
        url: String(url),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      }
      calls.push(call)
      if (call.method === "PUT") {
        if (hold) await gate
        if (failPut)
          return new Response(
            JSON.stringify({ error: "invalid_request", message: "Refused." }),
            { status: 422, headers: { "content-type": "application/json" } }
          )
        const changes = (call.body as { changes: Preference[] }).changes
        state = state.map((row) => {
          const change = changes.find(
            (c) => c.kind === row.kind && c.channel === row.channel
          )
          return change ? { ...row, mode: change.mode, explicit: true } : row
        })
      }
      return new Response(
        JSON.stringify({ emailConfigured, preferences: state }),
        { headers: { "content-type": "application/json" } }
      )
    })
  )
  return { calls, release: () => release() }
}
const renderPreferences = (role: string | null = "member") =>
  renderWith(
    <Toaster>
      <NotificationPreferences role={role} />
    </Toaster>
  )
const puts = (calls: Call[]) => calls.filter((call) => call.method === "PUT")

describe("NotificationsView review findings", () => {
  const first = item({})
  const other = item({
    id: "33333333-3333-4333-8333-333333333333",
    kind: "listing_access_lost",
  })
  const badgeOf = (client: QueryClient) =>
    client.getQueryData<{ unreadCount: number }>(
      queryKeys.notifications("badge")
    )?.unreadCount
  const selectedTab = () => screen.getByRole("tab", { selected: true })

  it("keeps Load more reachable when a pending change takes every loaded row off the page", async () => {
    nav.set("filter=unread")
    notificationServer({
      items: [item({})],
      nextCursor: "next",
      hold: "read",
    })
    renderView()
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark 1 shown as read" })
    )
    expect(
      await screen.findByRole("button", { name: "Load more notifications" })
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Nothing matches this filter")
    ).not.toBeInTheDocument()
  })

  describe("when the server saves fewer rows than were sent", () => {
    it("does not commit the batch as read when it saved none", async () => {
      const server = steppedServer([first, other])
      const client = mountScoped(OWNER, true)
      await screen.findByText("Publishing failed")
      await waitFor(() => expect(badgeOf(client)).toBe(2))
      fireEvent.click(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      )
      expect(bell()).toHaveAccessibleName("Notifications, 1 unread")
      server.holdLists()
      ;(await server.write(0)).accept(0)
      await waitFor(() =>
        expect(bell()).toHaveAccessibleName("Notifications, 2 unread")
      )
      await tick()
      expect(badgeOf(client)).toBe(2)
      expect(count()).toHaveTextContent("2 open and unread")
      expect(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      ).toBeInTheDocument()
      server.releaseLists()
    })

    it("commits it when the server saved every row", async () => {
      const server = steppedServer([first, other])
      const client = mountScoped(OWNER, true)
      await screen.findByText("Publishing failed")
      await waitFor(() => expect(badgeOf(client)).toBe(2))
      fireEvent.click(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      )
      server.holdLists()
      ;(await server.write(0)).accept(1)
      await waitFor(() => expect(badgeOf(client)).toBe(1))
      await tick()
      expect(badgeOf(client)).toBe(1)
      expect(bell()).toHaveAccessibleName("Notifications, 1 unread")
      server.releaseLists()
    })
  })

  describe("keyboard focus when a row leaves the filtered list", () => {
    it("moves to the filter tab at once and stays there when the change is refused", async () => {
      nav.set("filter=unread")
      const server = steppedServer([first, other])
      mountScoped(OWNER)
      const button = await screen.findByRole("button", {
        name: "Mark read: Publishing failed",
      })
      button.focus()
      fireEvent.click(button)
      expect(selectedTab()).toHaveFocus()
      ;(await server.write(0)).refuse()
      expect(
        await screen.findByText("Your change wasn’t saved")
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      ).toBeInTheDocument()
      expect(selectedTab()).toHaveFocus()
    })

    it("does the same for a resolve in the Open filter", async () => {
      nav.set("filter=open")
      const server = steppedServer([first, other])
      mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Resolve: Publishing failed",
        })
      )
      const yes = screen.getByRole("button", {
        name: "Yes, resolve: Publishing failed",
      })
      yes.focus()
      fireEvent.click(yes)
      expect(selectedTab()).toHaveFocus()
      ;(await server.write(0)).refuse()
      await screen.findByText("The notification wasn’t resolved")
      expect(selectedTab()).toHaveFocus()
    })

    it("leaves focus alone when the row stays in the list", async () => {
      const server = steppedServer([first, other])
      mountScoped(OWNER)
      const button = await screen.findByRole("button", {
        name: "Mark read: Publishing failed",
      })
      button.focus()
      fireEvent.click(button)
      expect(
        screen.getByRole("button", { name: "Mark unread: Publishing failed" })
      ).toBeInTheDocument()
      expect(selectedTab()).not.toHaveFocus()
      ;(await server.write(0)).accept()
    })
  })

  it("rebases the pin when the first of two changes on a row is removed after a poll saw it saved", async () => {
    const server = steppedServer([first, other])
    const client = mountScoped(OWNER, true)
    await screen.findByText("Publishing failed")
    await waitFor(() => expect(badgeOf(client)).toBe(2))
    // Read X: the server saves it but the answer is lost.
    fireEvent.click(
      screen.getByRole("button", { name: "Mark read: Publishing failed" })
    )
    // A shell poll now has the read: count 1, X not among the unread rows.
    act(() =>
      seedShellKeys(client, {
        counts: {},
        connections: [],
        notifications: { items: [other], nextCursor: null, unreadCount: 1 },
      } as unknown as ShellStatusResponse)
    )
    await tick()
    // Then unread X, queued behind it.
    fireEvent.click(
      screen.getByRole("button", { name: "Mark unread: Publishing failed" })
    )
    expect(bell()).toHaveAccessibleName("Notifications, 2 unread")
    server.holdLists()
    ;(await server.write(0)).refuse()
    await screen.findByText("Your change wasn’t saved")
    // The survivor is measured against X as it was before the lost change.
    await waitFor(() =>
      expect(bell()).toHaveAccessibleName("Notifications, 2 unread")
    )
    expect(count()).toHaveTextContent("2 open and unread")
    ;(await server.write(1)).accept()
    await waitFor(() => expect(badgeOf(client)).toBe(2))
    await tick()
    expect(badgeOf(client)).toBe(2)
    expect(bell()).toHaveAccessibleName("Notifications, 2 unread")
    server.releaseLists()
  })

  it("keeps the loaded rows, with a way to try again, when the refetch after a failed action also fails", async () => {
    const server = steppedServer([first, other])
    mountScoped(OWNER)
    await screen.findByText("Publishing failed")
    server.failLists()
    fireEvent.click(
      screen.getByRole("button", { name: "Mark read: Publishing failed" })
    )
    ;(await server.write(0)).refuse()
    expect(
      await screen.findByText("Your change wasn’t saved")
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/could not be refreshed/)
    ).toBeInTheDocument()
    expect(screen.getByText("Publishing failed")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Mark read: Publishing failed" })
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Notifications could not be loaded")
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })
})

describe("NotificationPreferences", () => {
  const publishing = [
    pref("publication_failed", "in_app", "immediate"),
    pref("publication_failed", "email", "off"),
  ]
  const twoEvents = [
    ...publishing,
    pref("schedule_missed", "in_app", "immediate"),
    pref("schedule_missed", "email", "off"),
  ]

  it("tells a member email is unavailable, offers no email rows and saves a switch", async () => {
    const { calls } = preferenceServer({
      emailConfigured: false,
      preferences: publishing,
    })
    renderPreferences("member")
    expect(
      await screen.findByText(
        "Email notifications aren’t available for this workspace yet. You’ll still see them in the app."
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Operations" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: /^Email:/ })
    ).not.toBeInTheDocument()
    const toggle = screen.getByRole("switch", { name: "Publishing failed" })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(puts(calls)[0]?.body).toEqual({
        changes: [
          { kind: "publication_failed", channel: "in_app", mode: "off" },
        ],
      })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Publishing failed" })
      ).not.toBeChecked()
    )
  })

  it("points an owner or admin to Operations", async () => {
    preferenceServer({ emailConfigured: false, preferences: publishing })
    renderPreferences("admin")
    expect(
      await screen.findByRole("link", { name: "Operations" })
    ).toHaveAttribute("href", "/settings/operations")
  })

  it("shows a switch change at once and disables only the row being saved", async () => {
    const { calls, release } = preferenceServer({
      emailConfigured: true,
      preferences: twoEvents,
      hold: true,
    })
    renderPreferences("owner")
    const publishingSwitch = await screen.findByRole("switch", {
      name: "Publishing failed",
    })
    fireEvent.click(publishingSwitch)
    // The request has not returned, yet the screen already shows the choice.
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    expect(publishingSwitch).not.toBeChecked()
    expect(publishingSwitch).toHaveAttribute("aria-disabled", "true")
    // Every other control stays live.
    expect(
      screen.getByRole("switch", { name: "Scheduled post missed" })
    ).not.toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("combobox", { name: "Email: Publishing failed" })
    ).toBeEnabled()
    // The group action waits for it: a bulk change sent now could be
    // overwritten by this earlier save.
    expect(
      screen.getByRole("button", { name: "Turn all on in app" })
    ).toBeDisabled()
    release()
    await waitFor(() =>
      expect(publishingSwitch).not.toHaveAttribute("aria-disabled", "true")
    )
    expect(publishingSwitch).not.toBeChecked()
    expect(
      screen.getByRole("button", { name: "Turn all on in app" })
    ).toBeEnabled()
  })

  it("sends saves one at a time, in the order they were made", async () => {
    const { calls, release } = preferenceServer({
      emailConfigured: true,
      preferences: twoEvents,
      hold: true,
    })
    renderPreferences("owner")
    const first = await screen.findByRole("switch", {
      name: "Publishing failed",
    })
    const second = screen.getByRole("switch", {
      name: "Scheduled post missed",
    })
    fireEvent.click(first)
    fireEvent.click(second)
    // Both show before any answer, but only the first request is out.
    await waitFor(() => expect(first).not.toBeChecked())
    await waitFor(() => expect(second).not.toBeChecked())
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(puts(calls)).toHaveLength(1)
    release()
    await waitFor(() => expect(puts(calls)).toHaveLength(2))
    expect(puts(calls).map((call) => call.body)).toEqual([
      {
        changes: [
          { kind: "publication_failed", channel: "in_app", mode: "off" },
        ],
      },
      {
        changes: [{ kind: "schedule_missed", channel: "in_app", mode: "off" }],
      },
    ])
  })

  it("leaves a row changed after the bulk action alone on Undo", async () => {
    const { calls } = preferenceServer({
      emailConfigured: true,
      preferences: twoEvents.map((row) =>
        row.channel === "in_app" ? { ...row, mode: "off" as const } : row
      ),
    })
    renderPreferences("owner")
    fireEvent.click(
      await screen.findByRole("button", { name: "Turn all on in app" })
    )
    await screen.findByText("Turned on in-app notifications")
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Publishing failed" })
      ).not.toHaveAttribute("aria-disabled", "true")
    )
    // A newer choice on one row…
    fireEvent.click(screen.getByRole("switch", { name: "Publishing failed" }))
    await waitFor(() => expect(puts(calls)).toHaveLength(2))
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Publishing failed" })
      ).not.toHaveAttribute("aria-disabled", "true")
    )
    // …survives Undo, which puts back only the row the bulk change left as
    // it was.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    await waitFor(() => expect(puts(calls)).toHaveLength(3))
    expect(puts(calls)[2]?.body).toEqual({
      changes: [{ kind: "schedule_missed", channel: "in_app", mode: "off" }],
    })
  })

  it("puts a refused choice back and says why", async () => {
    preferenceServer({
      emailConfigured: true,
      preferences: publishing,
      failPut: true,
    })
    renderPreferences("owner")
    fireEvent.click(
      await screen.findByRole("switch", { name: "Publishing failed" })
    )
    expect(
      await screen.findByText("Your notification choice wasn’t saved")
    ).toBeInTheDocument()
    expect(screen.getByText("Refused.")).toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Publishing failed" })
      ).toBeChecked()
    )
  })

  it("turns every in-app choice on in one request and offers Undo", async () => {
    const { calls } = preferenceServer({
      emailConfigured: true,
      preferences: [
        pref("publication_failed", "in_app", "off"),
        pref("publication_failed", "email", "off"),
        pref("schedule_missed", "in_app", "immediate"),
        pref("schedule_missed", "email", "off"),
      ],
    })
    renderPreferences("owner")
    fireEvent.click(
      await screen.findByRole("button", { name: "Turn all on in app" })
    )
    await waitFor(() =>
      expect(puts(calls)[0]?.body).toEqual({
        changes: [
          { kind: "publication_failed", channel: "in_app", mode: "immediate" },
          { kind: "schedule_missed", channel: "in_app", mode: "immediate" },
        ],
      })
    )
    expect(
      await screen.findByRole("button", { name: "Turn all off in app" })
    ).toBeInTheDocument()
    // Undo restores what each row held before, in one request.
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
    await waitFor(() => expect(puts(calls)).toHaveLength(2))
    expect(puts(calls)[1]?.body).toEqual({
      changes: [{ kind: "publication_failed", channel: "in_app", mode: "off" }],
    })
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Publishing failed" })
      ).not.toBeChecked()
    )
    expect(
      screen.getByRole("switch", { name: "Scheduled post missed" })
    ).toBeChecked()
  })

  it("still offers Undo when another save starts before the bulk action returns", async () => {
    const { calls, release } = preferenceServer({
      emailConfigured: true,
      preferences: twoEvents.map((row) =>
        row.channel === "in_app" ? { ...row, mode: "off" as const } : row
      ),
      hold: true,
    })
    renderPreferences("owner")
    fireEvent.click(
      await screen.findByRole("button", { name: "Turn all on in app" })
    )
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    // A second save starts while the bulk request is still out.
    await userEvent.click(
      screen.getByRole("combobox", { name: "Email: Publishing failed" })
    )
    await userEvent.click(
      await screen.findByRole("option", { name: "Daily summary" })
    )
    // Saves go out one at a time, so the second waits behind the first.
    await waitFor(() => expect(puts(calls)).toHaveLength(1))
    release()
    await waitFor(() => expect(puts(calls)).toHaveLength(2))
    expect(
      await screen.findByText("Turned on in-app notifications")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument()
  })

  it("draws no empty card for the email group without a provider", async () => {
    preferenceServer({ emailConfigured: false, preferences: publishing })
    renderPreferences("member")
    await screen.findByRole("heading", { name: "By email" })
    const group = document.getElementById("notification-email")!
    expect(group).not.toHaveAttribute("data-card")
    expect(group.querySelector("ul")).toBeNull()
  })

  it("sets the email cadence from a titled sheet row once email is available", async () => {
    const { calls } = preferenceServer({
      emailConfigured: true,
      preferences: publishing,
    })
    renderPreferences("owner")
    const row = await screen.findByRole("combobox", {
      name: "Email: Publishing failed",
    })
    expect(row).toHaveTextContent("Off")
    await userEvent.click(row)
    await userEvent.click(
      await screen.findByRole("option", { name: "Daily summary" })
    )
    await waitFor(() =>
      expect(puts(calls)[0]?.body).toEqual({
        changes: [
          { kind: "publication_failed", channel: "email", mode: "digest" },
        ],
      })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Email: Publishing failed" })
      ).toHaveTextContent("Daily summary")
    )
  })
})

describe("NotificationsView follow-ups to the Release & QA review", () => {
  const first = item({})
  const other = item({
    id: "33333333-3333-4333-8333-333333333333",
    kind: "listing_access_lost",
  })
  const manyRows = (n: number) =>
    Array.from({ length: n }, (_, index) =>
      item({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })
    )

  describe("keyboard focus after the inline confirmation", () => {
    it("returns to Resolve when the question is cancelled and the row stays", async () => {
      steppedServer([first, other])
      mountScoped(OWNER)
      const resolve = await screen.findByRole("button", {
        name: "Resolve: Publishing failed",
      })
      resolve.focus()
      fireEvent.click(resolve)
      const cancel = screen.getByRole("button", { name: "Cancel" })
      cancel.focus()
      fireEvent.click(cancel)
      expect(
        screen.getByRole("button", { name: "Resolve: Publishing failed" })
      ).toHaveFocus()
      expect(document.activeElement).not.toBe(document.body)
    })

    it("returns to the row's read button after Yes, resolve when the row stays", async () => {
      const server = steppedServer([first, other])
      mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Resolve: Publishing failed",
        })
      )
      const yes = screen.getByRole("button", {
        name: "Yes, resolve: Publishing failed",
      })
      yes.focus()
      fireEvent.click(yes)
      // A resolved row has no Resolve action; its own read button is next.
      expect(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      ).toHaveFocus()
      ;(await server.write(0)).accept()
      await tick()
      expect(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      ).toHaveFocus()
    })

    it("still goes to the filter tab when the row leaves the list", async () => {
      nav.set("filter=open")
      steppedServer([first, other])
      mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Resolve: Publishing failed",
        })
      )
      const yes = screen.getByRole("button", {
        name: "Yes, resolve: Publishing failed",
      })
      yes.focus()
      fireEvent.click(yes)
      expect(screen.getByRole("tab", { selected: true })).toHaveFocus()
    })
  })

  describe("a read the server saves only in part", () => {
    it("says so in a toast, with how many of the rows saved, and keeps them unread", async () => {
      const rows = manyRows(50)
      const server = steppedServer(rows)
      const client = mountScoped(OWNER, true)
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent(
          "50 open and unread"
        )
      )
      fireEvent.click(screen.getByRole("button", { name: "Mark all read" }))
      server.holdLists()
      // One of the fifty sent was saved; the server does not say which.
      ;(await server.write(0)).accept(1)
      expect(
        await screen.findByText("Some notifications weren’t marked as read")
      ).toBeInTheDocument()
      expect(
        screen.getByText("1 of 50 saved. The list shows what is saved.")
      ).toBeInTheDocument()
      await tick()
      expect(
        client.getQueryData<{ unreadCount: number }>(
          queryKeys.notifications("badge")
        )?.unreadCount
      ).toBe(50)
      expect(bell()).toHaveAccessibleName("Notifications, 50 unread")
      server.releaseLists()
    })

    it("says the change was not saved when none of the rows saved", async () => {
      const server = steppedServer([first, other])
      mountScoped(OWNER)
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Mark read: Publishing failed",
        })
      )
      server.holdLists()
      ;(await server.write(0)).accept(0)
      expect(
        await screen.findByText("Your change wasn’t saved")
      ).toBeInTheDocument()
      expect(
        screen.getByText("0 of 1 saved. The list shows what is saved.")
      ).toBeInTheDocument()
      server.releaseLists()
    })

    it("sends a repeated id once, so a full save is not taken for a short one", async () => {
      const server = steppedServer([first, other])
      const client = new QueryClient()
      client.setQueryData<SessionResponse>(queryKeys.session, {
        session: OWNER,
      })
      const { result } = renderHook(() => useNotificationChanges(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>
            <Toaster>{children}</Toaster>
          </QueryClientProvider>
        ),
      })
      act(() => result.current.markRead([first.id, first.id, other.id], true))
      const write = await server.write(0)
      expect(write.call.body).toEqual({
        incidentIds: [first.id, other.id],
        read: true,
      })
      // The server counts each id once: two saved, two sent.
      write.accept(2)
      await tick()
      expect(
        screen.queryByText("Some notifications weren’t marked as read")
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText("Your change wasn’t saved")
      ).not.toBeInTheDocument()
    })
  })

  describe("a list that could not be refreshed", () => {
    it("says a failed Load more could not load more, not that the list is out of date", async () => {
      const calls: Call[] = []
      let failMore = false
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          calls.push({ url: String(url), method: "GET", body: undefined })
          const more = new URL(String(url), "http://x").searchParams.has(
            "cursor"
          )
          if (more && failMore)
            return new Response(
              JSON.stringify({ error: "internal_error", message: "No." }),
              { status: 500, headers: { "content-type": "application/json" } }
            )
          return new Response(
            JSON.stringify({
              items: more ? [other] : [first],
              nextCursor: more ? null : "next",
              unreadCount: 2,
            }),
            { headers: { "content-type": "application/json" } }
          )
        })
      )
      mountScoped(OWNER)
      failMore = true
      fireEvent.click(
        await screen.findByRole("button", { name: "Load more notifications" })
      )
      expect(
        await screen.findByText("More notifications could not be loaded.")
      ).toBeInTheDocument()
      expect(
        screen.queryByText(/could not be refreshed/)
      ).not.toBeInTheDocument()
      expect(screen.getByText("Publishing failed")).toBeInTheDocument()
      failMore = false
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
      expect(await screen.findByText("Listing access lost")).toBeInTheDocument()
      expect(
        screen.queryByText("More notifications could not be loaded.")
      ).not.toBeInTheDocument()
    })

    it("keeps the out-of-date notice when the list that could not be refreshed is empty", async () => {
      nav.set("filter=unread")
      const server = steppedServer([
        item({ readAt: "2026-09-30T11:00:00.000Z" }),
      ])
      const client = mountScoped(OWNER)
      expect(
        await screen.findByText("Nothing matches this filter")
      ).toBeInTheDocument()
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      server.failLists()
      await act(() =>
        client.invalidateQueries({ queryKey: queryKeys.notificationsAll })
      )
      expect(
        await screen.findByText(
          "Notifications could not be refreshed. This list may be out of date."
        )
      ).toBeInTheDocument()
      expect(
        screen.getByText("Nothing matches this filter")
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Try again" })
      ).toBeInTheDocument()
    })
  })

  describe("labels", () => {
    it("names the settings link in full and shows a word for it on a phone", async () => {
      steppedServer([first])
      mountScoped(OWNER)
      const link = await screen.findByRole("link", {
        name: "Notification settings",
      })
      // Both visible forms are in the link; the name is the full words.
      expect(link).toHaveTextContent("SettingsNotification settings")
      expect(link.querySelector(".sr-only")).toBeNull()
    })

    it("says what each filter holds, so Open is not mistaken for Unread", async () => {
      steppedServer([first])
      mountScoped(OWNER)
      const hint = await screen.findByText(
        "Everything sent to you, newest first."
      )
      expect(hint).toBeInTheDocument()
      // The tab list is described by it, so a screen reader says it with the tabs.
      expect(screen.getByRole("tablist")).toHaveAttribute(
        "aria-describedby",
        hint.id
      )
      fireEvent.click(screen.getByRole("tab", { name: "Unread" }))
      expect(
        await screen.findByText("Notifications you have not marked read.")
      ).toBeInTheDocument()
      fireEvent.click(screen.getByRole("tab", { name: "Open" }))
      expect(
        await screen.findByText(
          "Problems nobody has resolved yet, whether read or not."
        )
      ).toBeInTheDocument()
    })
  })
})
