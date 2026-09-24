import { render, screen } from "@testing-library/react"
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

  it("keeps a period the next tab offers, and drops one it does not", async () => {
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
    expect(replace).toHaveBeenLastCalledWith("/reports?tab=keywords", {
      scroll: false,
    })
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
                      openWork: { needsReply: 0, awaitingApproval: 0, failed: 0 },
                      backfill: { running: 0, failed: 0, succeeded: 2, notStarted: 0 },
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
  })
})
