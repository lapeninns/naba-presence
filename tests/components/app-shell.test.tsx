import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "@/components/app-shell/app-shell"
import { ClientScopeProvider } from "@/components/app-shell/client-context"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Toaster } from "@/components/ui/toast"
import { QueryProvider } from "@/lib/queries/provider"

const push = vi.fn()
const pathname = vi.hoisted(() => ({ current: "/inbox" }))
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  // The shell reads a Google connect result from the address on any page.
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  push.mockReset()
  pathname.current = "/inbox"
})

// The phone tree (app bar, tab bar) and the tablet/desk tree (sidebar,
// toolbar) are both in the DOM and switched by CSS, so jsdom sees both:
// every query is scoped to the container it is about.
const slot = (name: string) =>
  document.querySelector<HTMLElement>(`[data-slot="${name}"]`)!

const session = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns Agency",
  workspaceMode: "agency" as const,
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
  overrides: {
    clients?: unknown[]
    connections?: unknown[]
    role?: string
  } = {}
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
                {
                  organisationId: "o",
                  name: "Lapen Inns Agency",
                  role: "owner",
                },
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
  it("has a skip link as the first focusable, targeting main", async () => {
    renderShell()
    const skip = screen.getByRole("link", { name: "Skip to content" })
    expect(skip).toHaveAttribute("href", "#main")
    await userEvent.tab()
    expect(skip).toHaveFocus()
    // The shell owns the target, focusable by script, around the page.
    const main = screen.getByRole("main")
    expect(main).toHaveAttribute("id", "main")
    expect(main).toHaveAttribute("tabindex", "-1")
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Inbox"
    )
  })

  it("renders exactly one main and one h1", () => {
    renderShell()
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
  })

  it("marks the active nav item in the sidebar and the tab bar", () => {
    renderShell()
    const sidebar = within(
      screen.getByRole("complementary", { name: "Sidebar" })
    )
    expect(sidebar.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(sidebar.getByRole("link", { name: "Clients" })).not.toHaveAttribute(
      "aria-current"
    )
    const tabs = within(slot("tab-bar"))
    expect(tabs.getByRole("link", { name: /^Inbox/ })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(tabs.getByRole("link", { name: "Clients" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  // LST-28: with scheduling off the page still opens (a link, the palette),
  // and it used to have no current item in the sidebar or on the phone.
  it("keeps Calendar in the navigation, as the current item, while scheduling is off and you are on it", () => {
    stubApi()
    pathname.current = "/calendar"
    render(
      <Toaster>
        <QueryProvider>
          <AppShell session={session} hideCalendar>
            <PageFrame>
              <PageHeader title="Publication calendar" />
            </PageFrame>
          </AppShell>
        </QueryProvider>
      </Toaster>
    )
    const sidebar = within(
      screen.getByRole("complementary", { name: "Sidebar" })
    )
    expect(sidebar.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    // An agency's phone bar holds Calendar in More, which then reads current.
    expect(
      within(slot("tab-bar")).getByRole("button", { name: "More" })
    ).toHaveAccessibleDescription(/current/i)
  })

  it("leaves Calendar out of the navigation elsewhere while scheduling is off", () => {
    stubApi()
    pathname.current = "/listings"
    render(
      <Toaster>
        <QueryProvider>
          <AppShell session={session} hideCalendar>
            <PageFrame>
              <PageHeader title="Listings" />
            </PageFrame>
          </AppShell>
        </QueryProvider>
      </Toaster>
    )
    expect(
      within(
        screen.getByRole("complementary", { name: "Sidebar" })
      ).queryByRole("link", { name: "Calendar" })
    ).toBeNull()
  })

  it("draws both navigation trees, each a labelled Primary nav", () => {
    renderShell()
    // One for phones (the tab bar), one for the rail/sidebar from 768px.
    const primaries = screen.getAllByRole("navigation", { name: "Primary" })
    expect(primaries).toHaveLength(2)
    expect(primaries).toContain(slot("tab-bar"))
    expect(
      within(slot("sidebar")).getByRole("navigation", { name: "Primary" })
    ).toBeInTheDocument()
    // No hamburger or left drawer any more.
    expect(
      screen.queryByRole("button", { name: /navigation/i })
    ).not.toBeInTheDocument()
  })

  it("names the agency and the signed-in person without fetching either", () => {
    renderShell()
    const sidebar = within(slot("sidebar"))
    expect(sidebar.getByText("Lapen Inns Agency")).toBeInTheDocument()
    expect(sidebar.getByText("Aman Shrestha")).toBeInTheDocument()
    // One client: nothing to switch, so the phone app bar names the workspace.
    expect(
      within(slot("app-bar")).getByText("Lapen Inns Agency")
    ).toBeInTheDocument()
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
    expect(await screen.findByText("1 client needs action")).toBeInTheDocument()
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

  it("shows a broken login on every page, with a reconnect for admins", async () => {
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
    // The same explanation Settings' connection card gives, then Google.
    await user.click(
      await screen.findByRole("button", { name: "Continue to Google" })
    )
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
    stubApi({
      connections: [{ ...brokenLogin, googleEmail: "l***@example.test" }],
      role: "member",
    })
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
        {
          ...brokenLogin,
          id: "g2",
          googleEmail:
            "a-very-long-shared-venue-manager-address@some-long-domain.example",
        },
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
    // The Inbox has its own review search, so the phone app bar leaves
    // the palette button out there: the toolbar's is the only one.
    expect(
      within(slot("app-bar")).queryByRole("button", { name: /^Search/ })
    ).toBeNull()
    await user.click(
      within(slot("toolbar")).getByRole("button", {
        name: "Search clients, listings, pages and actions",
      })
    )
    expect(
      await screen.findByRole("dialog", { name: "Commands" })
    ).toBeInTheDocument()
  })

  it("keeps the palette button in the phone app bar off the Inbox", () => {
    pathname.current = "/listings"
    renderShell()
    expect(
      within(slot("app-bar")).getByRole("button", {
        name: "Search clients, listings, pages and actions",
      })
    ).toBeInTheDocument()
  })

  it("has no client switcher for an agency with one client", async () => {
    renderShell()
    await screen.findByRole("link", { name: /Old Crown Group/ })
    expect(screen.queryByRole("button", { name: /^Client:/ })).toBeNull()
  })

  it("puts the client switcher in the toolbar and carries the remembered client in the nav", async () => {
    const harbour = { ...client, id: "c2", name: "Harbour Kitchen" }
    stubApi({ clients: [client, harbour] })
    render(
      <Toaster>
        <QueryProvider>
          <AppShell session={session} rememberedClientId="c2">
            <PageFrame>
              <PageHeader title="Inbox" />
            </PageFrame>
          </AppShell>
        </QueryProvider>
      </Toaster>
    )
    // The mocked page is an unscoped Inbox address: the switcher follows the
    // address (the sync fills the remembered client in through the router),
    // and the sidebar links already carry it.
    const toolbar = slot("toolbar")
    expect(
      await within(toolbar).findByRole("button", {
        name: "Client: All clients",
      })
    ).toBeInTheDocument()
    const primary = within(slot("sidebar")).getByRole("navigation", {
      name: "Primary",
    })
    expect(
      within(primary).getByRole("link", { name: "Inbox" })
    ).toHaveAttribute("href", "/inbox?clientId=c2")
    expect(
      within(primary).getByRole("link", { name: "Reports" })
    ).toHaveAttribute("href", "/reports?clientId=c2")
    expect(
      within(primary).getByRole("link", { name: "Clients" })
    ).toHaveAttribute("href", "/clients")
    // The phone tab bar carries the same scope, and the app bar's leading
    // control is the client chip (more than one client to switch between).
    const tabs = within(slot("tab-bar"))
    expect(tabs.getByRole("link", { name: /^Inbox/ })).toHaveAttribute(
      "href",
      "/inbox?clientId=c2"
    )
    expect(tabs.getByRole("link", { name: "Clients" })).toHaveAttribute(
      "href",
      "/clients"
    )
    expect(
      await within(slot("app-bar")).findByRole("button", { name: /^Client: / })
    ).toBeInTheDocument()
  })

  it("offers Switch client commands in the palette", async () => {
    const harbour = { ...client, id: "c2", name: "Harbour Kitchen" }
    stubApi({ clients: [client, harbour] })
    const user = userEvent.setup()
    renderStubbedShell()
    const toolbar = within(slot("toolbar"))
    await toolbar.findByRole("button", { name: "Client: All clients" })
    await user.click(
      toolbar.getByRole("button", {
        name: "Search clients, listings, pages and actions",
      })
    )
    expect(
      await screen.findByRole("option", {
        name: "Switch client: Harbour Kitchen",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: "Switch client: Old Crown Group" })
    ).toBeInTheDocument()
  })

  it("opens the More sheet from the tab bar, with Team and Settings in it", async () => {
    const user = userEvent.setup()
    renderShell()
    const more = within(slot("tab-bar")).getByRole("button", { name: "More" })
    expect(more).toHaveAttribute("aria-haspopup", "dialog")
    expect(more).toHaveAttribute("aria-expanded", "false")
    await user.click(more)
    const dialog = await screen.findByRole("dialog", { name: "More" })
    expect(more).toHaveAttribute("aria-expanded", "true")
    const nav = within(dialog).getByRole("navigation", { name: "More" })
    // Two taps from anywhere: More, then the destination.
    expect(within(nav).getByRole("link", { name: "Team" })).toHaveAttribute(
      "href",
      "/team"
    )
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings"
    )
    expect(
      within(dialog).getByRole("region", { name: "Account" })
    ).toBeInTheDocument()
  })

  it("puts a labelled back control in both bars on a deep page", async () => {
    pathname.current = "/settings/billing"
    renderShell()
    for (const name of ["app-bar", "toolbar"]) {
      const back = await within(slot(name)).findByRole("link", {
        name: "Back to Settings",
      })
      expect(back).toHaveAttribute("href", "/settings")
    }
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
      await screen.findByText(
        /Full access, including the agency.s settings and team/
      )
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
    expect(assign).toHaveBeenCalledWith(`${window.location.origin}/sign-in`)
  })

  it("stays in the app when the sign-out request fails", async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal("location", { ...window.location, assign })
    vi.spyOn(await import("@/lib/api/auth"), "signOut").mockRejectedValue(
      new Error("offline")
    )
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }))
    expect(await screen.findByText("Couldn’t sign out")).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it("hides the organisation switcher for someone who belongs to one", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: /Aman Shrestha/ }))
    await screen.findByRole("menuitem", { name: "Sign out" })
    expect(screen.queryByText("Switch organisation")).not.toBeInTheDocument()
  })
})
