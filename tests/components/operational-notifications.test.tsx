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
    renderWith(<NotificationsView />)
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
    renderWith(<NotificationsView />)
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
    const first = renderWith(<NotificationsView />)
    await screen.findByText("Publishing failed")
    fireEvent.click(screen.getByRole("tab", { name: "Unread" }))
    expect(nav.search).toBe("filter=unread")
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("filter=unread"))).toBe(
        true
      )
    )
    first.unmount()
    renderWith(<NotificationsView />)
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
    renderWith(<NotificationsView />)
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
    renderWith(<NotificationsView />)
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

  it("names the pending confirm by the words it shows", async () => {
    let release: () => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/resolve"))
          await new Promise<void>((resolve) => (release = resolve))
        return new Response(
          JSON.stringify(
            String(url).endsWith("/resolve")
              ? { resolved: true }
              : { items: [item({})], nextCursor: null, unreadCount: 1 }
          ),
          { headers: { "content-type": "application/json" } }
        )
      })
    )
    renderWith(<NotificationsView />)
    fireEvent.click(
      await screen.findByRole("button", { name: "Resolve: Publishing failed" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, resolve: Publishing failed" })
    )
    // WCAG 2.5.3: the accessible name starts with the visible "Resolving…".
    const pending = await screen.findByRole("button", {
      name: "Resolving… Publishing failed",
    })
    expect(pending).toHaveTextContent("Resolving…")
    expect(pending).toBeDisabled()
    release()
  })

  it("disables only the row a pending change touches", async () => {
    let release: () => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/notifications/read"))
          await new Promise<void>((resolve) => (release = resolve))
        return new Response(
          JSON.stringify(
            String(url).endsWith("/read")
              ? { updated: 1 }
              : { items: [item({}), second], nextCursor: null, unreadCount: 2 }
          ),
          { headers: { "content-type": "application/json" } }
        )
      })
    )
    renderWith(<NotificationsView />)
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Mark read: Publishing failed",
      })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mark read: Publishing failed" })
      ).toBeDisabled()
    )
    expect(
      screen.getByRole("button", { name: "Mark read: Listing access lost" })
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: "Resolve: Listing access lost" })
    ).toBeEnabled()
    release()
  })

  it("explains a failed change in plain words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/read")
          ? new Response(
              JSON.stringify({
                error: "internal_error",
                message: 'relation "x" does not exist',
              }),
              { status: 500, headers: { "content-type": "application/json" } }
            )
          : new Response(
              JSON.stringify({
                items: [item({})],
                nextCursor: null,
                unreadCount: 1,
              }),
              { headers: { "content-type": "application/json" } }
            )
      )
    )
    renderWith(<NotificationsView />)
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Mark read: Publishing failed",
      })
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).not.toMatch(/relation/)
    expect(alert.textContent?.length).toBeGreaterThan(0)
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
    renderWith(<NotificationsView />)
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
    renderWith(<NotificationsView />)
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
    renderWith(<NotificationsView />)
    expect(
      await screen.findByRole("heading", { name: "No notifications yet" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Problems with Google connections, publishing and syncs/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Show all notifications" })
    ).not.toBeInTheDocument()
  })

  it("offers All from an empty filtered view", async () => {
    nav.set("filter=unread")
    const calls = stub(() => ({ items: [], nextCursor: null, unreadCount: 0 }))
    renderWith(<NotificationsView />)
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
        "Email notifications aren't available for this workspace yet. You'll still see them in the app."
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
    expect(
      screen.getByRole("button", { name: "Turn all on in app" })
    ).toBeEnabled()
    release()
    await waitFor(() =>
      expect(publishingSwitch).not.toHaveAttribute("aria-disabled", "true")
    )
    expect(publishingSwitch).not.toBeChecked()
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
