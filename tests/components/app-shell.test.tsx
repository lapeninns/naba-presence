import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell/app-shell"
import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Toaster } from "@/components/ui/toast"
import { QueryProvider } from "@/lib/queries/provider"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  // The shell reads a Google connect result from the address on any page.
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  push.mockReset()
})

const session = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns Agency",
  displayName: "Aman Shrestha",
  email: "a@example.test",
  role: "owner" as const,
  canPublish: true,
}

const client = {
  id: "c1",
  name: "Old Crown Group",
  slug: "old-crown-group",
  colour: null,
  logoUrl: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  locationCount: 3,
  linkedCount: 3,
  verifiedCount: 2,
  health: "healthy" as const,
  connections: [],
  openWork: { needsReply: 4, awaitingApproval: 1, failed: 0 },
  backfill: { running: 0, failed: 0, succeeded: 3, notStarted: 0 },
  lastSyncAt: "2026-09-03T10:00:00.000Z",
}

function stubApi(
  overrides: { clients?: unknown[]; connections?: unknown[]; role?: string } = {}
) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const body = url.includes("/api/google/connections")
      ? { connections: overrides.connections ?? [] }
      : url.includes("/api/clients")
      ? { items: overrides.clients ?? [client], unassignedLocationCount: 0 }
      : url.includes("/api/organisations")
        ? {
            items: [
              { organisationId: "o", name: "Lapen Inns Agency", role: "owner" },
            ],
          }
        : url.includes("/api/session")
          ? { session: { ...session, role: overrides.role ?? session.role } }
          : { locations: [] }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/** The shell over an already-stubbed API. */
function renderStubbedShell() {
  return render(
    <Toaster>
      <QueryProvider>
        <AppShell session={session}>
          <PageFrame>
            <PageHeader title="Inbox" description="Every review" />
          </PageFrame>
        </AppShell>
      </QueryProvider>
    </Toaster>
  )
}

function renderShell() {
  stubApi()
  return render(
    // The root layout's Toaster wraps the shell in the app.
    <Toaster>
      <QueryProvider>
        <AppShell session={session}>
          <PageFrame>
            <PageHeader title="Inbox" description="Every review" />
          </PageFrame>
        </AppShell>
      </QueryProvider>
    </Toaster>
  )
}

describe("AppShell", () => {
  it("has a skip link as the first focusable, targeting main", () => {
    renderShell()
    const skip = screen.getByRole("link", { name: "Skip to content" })
    expect(skip).toHaveAttribute("href", "#main")
    expect(screen.getByRole("main")).toHaveAttribute("id", "main")
  })

  it("renders exactly one main and one h1", () => {
    renderShell()
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })

  it("marks the active nav item", () => {
    renderShell()
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("link", { name: "Clients" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  it("names the agency and the signed-in person without fetching either", () => {
    renderShell()
    expect(screen.getByText("Lapen Inns Agency")).toBeInTheDocument()
    expect(screen.getByText("Aman Shrestha")).toBeInTheDocument()
  })

  it("pins the agency's clients into the sidebar", async () => {
    renderShell()
    expect(
      await screen.findByRole("link", { name: /Old Crown Group/ })
    ).toHaveAttribute("href", "/clients/c1")
  })

  it("reports health as a count, not a single worst-case word", async () => {
    stubApi({
      clients: [
        client,
        {
          ...client,
          id: "c2",
          name: "Harbour Kitchen",
          health: "disconnected",
        },
        { ...client, id: "c3", name: "Bella Vita", health: "attention" },
      ],
    })
    render(
      <Toaster>
      <QueryProvider>
        <AppShell session={session}>
          <PageFrame>
            <PageHeader title="Inbox" />
          </PageFrame>
        </AppShell>
      </QueryProvider>
      </Toaster>
    )
    // "2 clients need attention" tells an agency where to look. The old chip
    // said only "disconnected" whenever any connection anywhere was down.
    // Action needed outranks delayed data: the count names the clients a
    // person has to do something for.
    expect(
      await screen.findByText("1 client needs action")
    ).toBeInTheDocument()
  })

  const brokenLogin = {
    id: "g1",
    googleEmail: "login@example.test",
    status: "revoked",
    notificationsEnabled: false,
    lastRefreshAt: null,
    lastErrorCode: "invalid_grant",
    reconnectRequired: true,
    reconnectReason: "invalid_grant",
    createdAt: "2026-01-01T00:00:00.000Z",
  }

  it("scopes the toolbar chip to the page's client", async () => {
    // The chip is drawn by the shell, above the routed page, so the page's
    // ClientScopeProvider has to reach up to it.
    stubApi({ clients: [{ ...client, health: "disconnected" }] })
    render(
      <Toaster>
        <QueryProvider>
          <AppShell session={session}>
            <ClientScopeProvider clientId="c1">
              <PageFrame>
                <PageHeader title="Old Crown Group" />
              </PageFrame>
            </ClientScopeProvider>
          </AppShell>
        </QueryProvider>
      </Toaster>
    )
    expect(
      await screen.findByRole("link", { name: /^Old Crown Group: / })
    ).toHaveAttribute("href", "/clients/c1")
  })

  it("shows a broken login on every page, with a one-click reconnect for admins", async () => {
    // Org-wide: this page belongs to no client, and the login has no linked
    // locations left -- the old client-scoped banner showed nothing here.
    const fetchMock = stubApi({ connections: [brokenLogin] })
    const user = userEvent.setup()
    renderStubbedShell()
    expect(
      await screen.findByText("Google stopped accepting login@example.test.")
    ).toBeInTheDocument()
    const reconnect = screen.getByRole("button", {
      name: "Reconnect login@example.test",
    })
    await user.click(reconnect)
    const start = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/api/google/connect/start")
    )
    expect(start).toBeDefined()
    // The login is targeted (so Google pre-selects it) and the person comes
    // back to the page they clicked on.
    expect(JSON.parse(String(start![1]!.body))).toEqual({
      reconnectConnectionId: "g1",
      returnTo: "/",
    })
  })

  it("tells other roles who can fix it, without a reconnect control", async () => {
    stubApi({ connections: [{ ...brokenLogin, googleEmail: "l***@example.test" }], role: "member" })
    render(
      <Toaster>
        <QueryProvider>
          <AppShell session={{ ...session, role: "member" }}>
            <PageFrame>
              <PageHeader title="Inbox" />
            </PageFrame>
          </AppShell>
        </QueryProvider>
      </Toaster>
    )
    expect(
      await screen.findByText(/Ask an owner or admin to reconnect it\./)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Reconnect/ })
    ).not.toBeInTheDocument()
  })

  it("counts the other broken logins and links to them all", async () => {
    stubApi({
      connections: [
        brokenLogin,
        { ...brokenLogin, id: "g2", googleEmail: "a-very-long-shared-venue-manager-address@some-long-domain.example" },
      ],
    })
    render(
      <Toaster>
        <QueryProvider>
          <AppShell session={session}>
            <PageFrame>
              <PageHeader title="Inbox" />
            </PageFrame>
          </AppShell>
        </QueryProvider>
      </Toaster>
    )
    expect(
      await screen.findByText(/1 other Google login needs reconnecting too\./)
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/settings/connections"
    )
  })

  it("offers a command palette from the toolbar's search button", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(
      screen.getByRole("button", {
        name: "Search clients, listings, pages and actions",
      })
    )
    expect(
      await screen.findByPlaceholderText(
        "Go to a client, a location or an action…"
      )
    ).toBeInTheDocument()
  })

  it("opens the mobile nav in a labelled sheet", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Open navigation" }))
    const dialog = await screen.findByRole("dialog", { name: "Navigation" })
    // A left drawer, not the shared Sheet's phone bottom sheet: navigation
    // slides in from the edge the sidebar lives on (reference: min(300px,
    // 86vw)), and the toggle reports it is open.
    expect(dialog).toHaveClass("left-0", "w-[min(300px,86vw)]")
    expect(dialog).toHaveAttribute("id", "mobile-navigation")
    expect(
      within(dialog).getByRole("navigation", { name: "Primary" })
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole("button", { name: "Close navigation" })
    ).toBeInTheDocument()
  })
})

describe("session-ready children gate", () => {
  it("holds routed children until the bootstrap session cookie resolves", async () => {
    // No `session` prop: the local-bootstrap, first-anonymous-visit path.
    // `useSessionReady` starts closed and provisions the cookie first, so the
    // page's own queries cannot 401 and hard-navigate to /sign-in.
    stubApi()
    render(
      <Toaster>
      <QueryProvider>
        <AppShell session={null}>
          <div>gated-child</div>
        </AppShell>
      </QueryProvider>
      </Toaster>
    )
    expect(screen.queryByText("gated-child")).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText("gated-child")).toBeInTheDocument()
    )
  })

  it("bootstraps the session with an abortable request", async () => {
    const fetchMock = stubApi()
    render(
      <Toaster>
      <QueryProvider>
        <AppShell session={null}>content</AppShell>
      </QueryProvider>
      </Toaster>
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe("account menu", () => {
  it("explains what the role permits rather than showing a bare word", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    expect(
      await screen.findByText(/Full access, including compliance and billing/)
    ).toBeInTheDocument()
  })

  it("clears the session then leaves the app", async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    const signOutSpy = vi
      .spyOn(await import("@/lib/api/auth"), "signOut")
      .mockResolvedValue(undefined)
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))
    await waitFor(() => expect(signOutSpy).toHaveBeenCalled())
    expect(assign).toHaveBeenCalledWith("/sign-in")
  })

  it("still leaves the app when the sign-out request fails", async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    vi.spyOn(await import("@/lib/api/auth"), "signOut").mockRejectedValue(
      new Error("offline")
    )
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/sign-in"))
  })

  it("hides the organisation switcher for someone who belongs to one", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    await screen.findByRole("menuitem", { name: "Sign out" })
    expect(screen.queryByText("Switch organisation")).not.toBeInTheDocument()
  })
})
