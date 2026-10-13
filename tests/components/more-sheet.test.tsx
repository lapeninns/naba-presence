import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const pathname = vi.hoisted(() => ({ current: "/listings" }))
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { AppShell, type ShellSession } from "@/components/app-shell/app-shell"
import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Toaster } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"

// The phone's More sheet, opened from the tab bar the way a person does,
// inside the real shell: what it holds per role and mode, and the account
// block's sign-out and organisation-switch rules.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  pathname.current = "/listings"
})

const baseSession: ShellSession = {
  sessionId: "s",
  userId: "u",
  organisationId: "o",
  organisationName: "Lapen Inns Agency",
  workspaceMode: "agency",
  displayName: "Aman Shrestha",
  email: "a@example.test",
  role: "owner",
  canPublish: true,
}

function client(id: string, name: string, health = "healthy") {
  return {
    id,
    name,
    slug: id,
    colour: null,
    logoUrl: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    locationCount: 1,
    linkedCount: 1,
    verifiedCount: 1,
    health,
    connections: [],
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 1, notStarted: 0 },
    lastSyncAt: null,
  }
}

const oneClient = [client("c1", "Old Crown Group", "disconnected")]
const twoClients = [...oneClient, client("c2", "Harbour Kitchen")]

function renderShell({
  session = baseSession,
  clients = twoClients,
  organisations = [{ organisationId: "o", name: "Lapen Inns Agency" }],
  unread = 0,
  hideCalendar = false,
}: {
  session?: ShellSession
  clients?: unknown[]
  organisations?: { organisationId: string; name: string }[]
  unread?: number
  hideCalendar?: boolean
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      const body = url.includes("/api/clients")
        ? { items: clients, unassignedLocationCount: 0 }
        : url.includes("/api/organisations")
          ? {
              items: organisations.map((org) => ({ ...org, role: "owner" })),
            }
          : url.includes("/api/google/connections")
            ? { connections: [] }
            : { locations: [] }
      return Response.json(body)
    })
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(queryKeys.session, { session })
  queryClient.setQueryData(queryKeys.notifications("badge"), {
    items: [],
    nextCursor: null,
    unreadCount: unread,
  })
  render(
    <Toaster>
      <QueryClientProvider client={queryClient}>
        <AppShell session={session} hideCalendar={hideCalendar}>
          <PageFrame>
            <PageHeader title="Listings" />
          </PageFrame>
        </AppShell>
      </QueryClientProvider>
    </Toaster>
  )
}

async function openMore() {
  const tabBar = document.querySelector<HTMLElement>('[data-slot="tab-bar"]')!
  await userEvent.click(within(tabBar).getByRole("button", { name: "More" }))
  const dialog = await screen.findByRole("dialog", { name: "More" })
  return { dialog, sheet: within(dialog) }
}

const destinationLabels = (dialog: HTMLElement) =>
  within(within(dialog).getByRole("navigation", { name: "More" }))
    .getAllByRole("link")
    .map((link) => link.textContent)

describe("More sheet contents", () => {
  it("gives an agency owner Calendar, Notifications, Team and Settings, two taps away", async () => {
    renderShell({ unread: 3 })
    const { dialog, sheet } = await openMore()
    expect(destinationLabels(dialog)).toEqual([
      "Calendar",
      "Notifications3",
      "Team",
      "Settings",
    ])
    const nav = within(sheet.getByRole("navigation", { name: "More" }))
    expect(nav.getByRole("link", { name: "Team" })).toHaveAttribute(
      "href",
      "/team"
    )
    expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings"
    )
    // The unread count is in the row's name, not a bare number.
    expect(
      nav.getByRole("link", { name: "Notifications, 3 unread" })
    ).toHaveAttribute("href", "/notifications")
  })

  it("gives a business Notifications, Team and Settings", async () => {
    renderShell({
      session: { ...baseSession, workspaceMode: "business" },
    })
    const { dialog, sheet } = await openMore()
    expect(destinationLabels(dialog)).toEqual([
      "Notifications",
      "Team",
      "Settings",
    ])
    expect(
      sheet.getByRole("button", { name: "Search listings and pages" })
    ).toBeInTheDocument()
    // No client layer: no "Working on" row however many clients exist.
    expect(sheet.queryByText("Working on")).not.toBeInTheDocument()
  })

  it.each(["member", "viewer"] as const)(
    "leaves Team out for a %s and keeps Settings",
    async (role) => {
      renderShell({ session: { ...baseSession, role } })
      const { dialog } = await openMore()
      expect(destinationLabels(dialog)).toEqual([
        "Calendar",
        "Notifications",
        "Settings",
      ])
    }
  )

  it("leaves Calendar out when scheduling is off", async () => {
    renderShell({ hideCalendar: true })
    const { dialog } = await openMore()
    expect(destinationLabels(dialog)).not.toContain("Calendar")
  })

  it("opens with a search row", async () => {
    renderShell()
    const { sheet } = await openMore()
    expect(
      sheet.getByRole("button", { name: "Search clients, listings and pages" })
    ).toBeInTheDocument()
  })

  it("shows which client is being worked when an agency has more than one", async () => {
    renderShell()
    const { sheet } = await openMore()
    const row = await sheet.findByRole("button", { name: /^Working on/ })
    expect(row).toHaveAttribute("aria-haspopup", "dialog")
    expect(row).toHaveTextContent("All clients")
  })

  it("has no Working on row for an agency with one client", async () => {
    renderShell({ clients: oneClient })
    const { sheet } = await openMore()
    await sheet.findByRole("link", { name: /^Connections/ })
    expect(
      sheet.queryByRole("button", { name: /^Working on/ })
    ).not.toBeInTheDocument()
  })

  it("states connection health in words, not a dot alone", async () => {
    renderShell()
    const { sheet } = await openMore()
    const row = await sheet.findByRole("link", {
      // The two lines are separate spans (jsdom does not lay out the
      // column, so no space is computed between them).
      name: /^Connections\s*1 client needs action$/,
    })
    expect(row).toHaveAttribute("href", "/clients")
    expect(row).toHaveAccessibleDescription("Connection status")
  })

  it("ends with the account: name, email, theme and sign out", async () => {
    renderShell()
    const { sheet } = await openMore()
    const account = within(sheet.getByRole("region", { name: "Account" }))
    expect(account.getByText("Aman Shrestha")).toBeInTheDocument()
    expect(account.getByText("a@example.test")).toBeInTheDocument()
    const theme = account.getByRole("radiogroup", { name: "Theme" })
    expect(
      within(theme)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent)
    ).toEqual(["Light", "Dark", "Match system"])
    expect(
      account.getByRole("button", { name: "Sign out" })
    ).toBeInTheDocument()
    expect(
      account.getByRole("button", { name: "Sign out everywhere…" })
    ).toBeInTheDocument()
  })
})

describe("More sheet account block", () => {
  it("clears the session then leaves the app", async () => {
    const assign = vi.fn()
    renderShell()
    vi.stubGlobal("location", { ...window.location, assign })
    const signOut = vi
      .spyOn(await import("@/lib/api/auth"), "signOut")
      .mockResolvedValue(undefined)
    const { sheet } = await openMore()
    await userEvent.click(sheet.getByRole("button", { name: "Sign out" }))
    await waitFor(() =>
      expect(signOut).toHaveBeenCalledWith({ everywhere: false })
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`${window.location.origin}/sign-in`)
    )
  })

  it("stays in the app when the sign-out request fails", async () => {
    const assign = vi.fn()
    renderShell()
    vi.stubGlobal("location", { ...window.location, assign })
    vi.spyOn(await import("@/lib/api/auth"), "signOut").mockRejectedValue(
      new Error("offline")
    )
    const { sheet } = await openMore()
    await userEvent.click(sheet.getByRole("button", { name: "Sign out" }))
    expect(await screen.findByText("Couldn’t sign out")).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  const twoOrgs = [
    { organisationId: "o", name: "Lapen Inns Agency" },
    { organisationId: "o2", name: "Second Agency" },
  ]

  it("offers the other organisations to someone in more than one", async () => {
    renderShell({ organisations: twoOrgs })
    const { sheet } = await openMore()
    expect(
      await sheet.findByRole("button", { name: "Second Agency" })
    ).toBeInTheDocument()
    expect(sheet.getByText("Switch organisation")).toBeInTheDocument()
  })

  it("hides the organisation switch inside a support impersonation", async () => {
    renderShell({
      organisations: twoOrgs,
      session: {
        ...baseSession,
        supportActor: "support@example.test",
        impersonationReason: "Ticket 12",
      },
    })
    const { sheet } = await openMore()
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([input]) =>
            String(input).includes("/api/organisations")
          )
      ).toBe(true)
    )
    expect(sheet.queryByText("Switch organisation")).not.toBeInTheDocument()
    expect(
      sheet.queryByRole("button", { name: "Second Agency" })
    ).not.toBeInTheDocument()
  })
})
