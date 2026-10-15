import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()
let search = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams(search),
}))

import { PerformanceView } from "@/components/performance/performance-view"
import { ToastProvider } from "@/components/ui/toast"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  replace.mockReset()
  search = ""
})

function renderView() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-31T23:59:59.999Z",
            timezone: "Europe/London",
            summary: {
              reviewVolume: 0,
              averageRating: null,
              responseRate: null,
              unresolvedComplaints: 0,
              verificationFailures: 0,
              verificationRejectionRate: null,
              medianFirstResponseSeconds: null,
              p95FirstResponseSeconds: null,
              medianLatestEditSeconds: null,
            },
            series: [],
            locations: [],
            providerTotals: {
              averageRating: null,
              totalReviewCount: null,
              localReviewCount: 0,
              divergence: false,
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PerformanceView />
    </QueryClientProvider>
  )
}

describe("PerformanceView", () => {
  it("exposes all three tabs and defaults to reply when tab is absent", () => {
    renderView()
    expect(
      screen.getByRole("tab", { name: "Reply performance" })
    ).toHaveAttribute("aria-selected", "true")
    expect(
      screen.getByRole("tab", { name: "Google performance" })
    ).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Keywords" })).toBeInTheDocument()
  })
  it("reflects ?tab=keywords as the active tab", () => {
    search = "tab=keywords"
    renderView()
    expect(screen.getByRole("tab", { name: "Keywords" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })

  it("writes the selected report tab to the URL", async () => {
    renderView()

    await userEvent.click(
      screen.getByRole("tab", { name: "Google performance" })
    )

    expect(replace).toHaveBeenCalledWith("/reports?tab=google", {
      scroll: false,
    })
  })

  // CLR-24: the period used to be dropped when the next tab did not offer
  // it, so it changed on screen with no word. Each tab keeps its own now.
  it("never changes the period in the address when switching tab", async () => {
    search = "tab=google&range=12m"
    renderView()
    await userEvent.click(screen.getByRole("tab", { name: "Keywords" }))
    expect(replace).toHaveBeenLastCalledWith(
      "/reports?tab=keywords&range=12m",
      { scroll: false }
    )
    replace.mockReset()
    search = "tab=google&range=90d"
    renderView()
    await userEvent.click(
      screen.getAllByRole("tab", { name: "Keywords" }).at(-1)!
    )
    expect(replace).toHaveBeenLastCalledWith(
      "/reports?tab=keywords&range=90d",
      { scroll: false }
    )
  })

  it("never waits forever on a client list that failed", async () => {
    // The stub answers every request with an overview, which the client list
    // cannot parse: a failed load, not a slow one.
    search = "clientId=00000000-0000-4000-8000-000000000001"
    renderView()
    expect(
      await screen.findByText("We couldn’t load your clients")
    ).toBeInTheDocument()
    expect(screen.queryByText("Loading client…")).not.toBeInTheDocument()
  })

  it("offers the client's locations under the client", async () => {
    const clientId = "00000000-0000-4000-8000-000000000001"
    search = `clientId=${clientId}`
    const row = (id: string, name: string) => ({
      locationId: id,
      name,
      address: null,
      timezone: "Europe/London",
      linkId: `link-${id}`,
      externalLocationId: `e-${id}`,
      googleLocationName: `locations/${id}`,
      googleTitle: name,
      verified: true,
      clientId,
      clientName: "Old Crown Group",
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const body = url.includes("/api/session")
          ? {
              session: {
                userId: "u1",
                organisationId: "o1",
                organisationName: "Agency",
                workspaceMode: "agency",
                displayName: "Owner",
                email: "owner@example.test",
                role: "owner",
                canPublish: true,
              },
            }
          : url.includes("/api/location-links")
            ? { locations: [row("l1", "Girton"), row("l2", "Histon")] }
            : url.includes("/api/clients")
              ? {
                  items: [
                    {
                      id: clientId,
                      name: "Old Crown Group",
                      slug: "old-crown-group",
                      colour: null,
                      logoUrl: null,
                      notes: null,
                      archivedAt: null,
                      createdAt: "2026-01-01T00:00:00.000Z",
                      locationCount: 2,
                      linkedCount: 2,
                      verifiedCount: 2,
                      health: "healthy",
                      connections: [],
                      openWork: {
                        needsReply: 0,
                        awaitingApproval: 0,
                        failed: 0,
                      },
                      backfill: {
                        running: 0,
                        failed: 0,
                        succeeded: 2,
                        notStarted: 0,
                      },
                      lastSyncAt: null,
                    },
                  ],
                  unassignedLocationCount: 0,
                }
              : {}
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <PerformanceView />
      </QueryClientProvider>
    )
    expect(await screen.findByText("Location")).toBeInTheDocument()
    expect(screen.getByText("Every location")).toBeInTheDocument()
    // One client in scope and an owner: the report can be shared, from the
    // report's actions menu rather than a button of its own.
    await userEvent.click(
      await screen.findByRole("button", { name: "More actions" })
    )
    expect(
      await screen.findByRole("menuitem", { name: "Share report" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "Share a client’s report" })
    ).not.toBeInTheDocument()
  })

  it("offers no share without anyone who may share it", async () => {
    renderView()
    await screen.findByRole("tab", { name: "Reply performance" })
    expect(
      screen.queryByRole("button", { name: "More actions" })
    ).not.toBeInTheDocument()
  })
})

function stubAgency(role: "owner" | "member") {
  const client = (id: string, name: string) => ({
    id,
    name,
    slug: name.toLowerCase().replaceAll(" ", "-"),
    colour: null,
    logoUrl: null,
    notes: null,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    locationCount: 2,
    linkedCount: 2,
    verifiedCount: 2,
    health: "healthy",
    connections: [],
    openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
    backfill: { running: 0, failed: 0, succeeded: 2, notStarted: 0 },
    lastSyncAt: null,
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes("/api/session")
        ? {
            session: {
              userId: "u1",
              organisationId: "o1",
              organisationName: "Agency",
              workspaceMode: "agency",
              displayName: "Someone",
              email: "someone@example.test",
              role,
              canPublish: true,
            },
          }
        : url.includes("/api/location-links")
          ? { locations: [] }
          : url.includes("/api/clients")
            ? {
                items: [
                  client("00000000-0000-4000-8000-000000000001", "Old Crown"),
                  client("00000000-0000-4000-8000-000000000002", "Harbour Kitchen"),
                ],
                unassignedLocationCount: 0,
              }
            : url.includes("/api/report-shares") || url.includes("/report-shares")
              ? { shares: [] }
              : {}
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      })
    })
  )
}

function renderAgencyView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PerformanceView />
      </ToastProvider>
    </QueryClientProvider>
  )
}

describe("PerformanceView share from All clients (CLR-10)", () => {
  it("offers Share a client's report in the menu and asks which client", async () => {
    stubAgency("owner")
    renderAgencyView()
    await userEvent.click(
      await screen.findByRole("button", { name: "More actions" })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Share a client’s report" })
    )
    const sheet = await screen.findByRole("dialog", {
      name: "Share a client’s report",
    })
    expect(
      within(sheet).getByRole("option", { name: /^Harbour Kitchen/ })
    ).toBeInTheDocument()
    await userEvent.click(
      within(sheet).getByRole("option", { name: /^Old Crown/ })
    )
    // On to the share step for the chosen client.
    expect(
      await screen.findByRole("dialog", { name: "Share Old Crown’s report" })
    ).toBeInTheDocument()
  })

  it("is not offered to someone who cannot share", async () => {
    stubAgency("member")
    renderAgencyView()
    await screen.findByRole("tab", { name: "Reply performance" })
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "More actions" })
      ).not.toBeInTheDocument()
    )
  })
})
