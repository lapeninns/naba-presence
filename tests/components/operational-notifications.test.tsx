import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

import { NotificationsView } from "@/components/notifications/notifications-view"
import { NotificationPreferences } from "@/components/settings/notification-preferences"
import { Toaster } from "@/components/ui/toast"

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
}
/**
 * A server that keeps the notifications: read and resolve change what the
 * next list returns, so a refetch after a change shows the real answer.
 */
function notificationServer({ items, fail, hold }: ServerOptions) {
  let state = items
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
          nextCursor: null,
          unreadCount: state.filter(
            (row) => row.status === "open" && !row.readAt
          ).length,
        })
      }
      if (hold === path) await gate
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
