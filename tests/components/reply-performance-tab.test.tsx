import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReplyLocationsTable } from "@/components/performance/reply-locations-table"
import { ReplyPerformanceTab } from "@/components/performance/reply-performance-tab"

function locationRow(id: string, name: string) {
  return {
    id,
    name,
    reviews: 4,
    averageRating: 4.5,
    responseRate: 80,
    medianFirstResponseSeconds: 3600,
    p95FirstResponseSeconds: null,
    medianLatestEditSeconds: null,
    unresolvedComplaints: 0,
    verificationRejectionRate: null,
  }
}

function stubOverview(
  locations: ReturnType<typeof locationRow>[],
  reviewVolume = 4
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            from: "2026-01-01T00:00:00.000Z",
            to: "2026-01-31T00:00:00.000Z",
            timezone: "Europe/London",
            summary: {
              reviewVolume,
              averageRating: 4.5,
              responseRate: 80,
              unresolvedComplaints: 0,
              verificationFailures: 0,
              verificationRejectionRate: null,
              medianFirstResponseSeconds: 3600,
              p95FirstResponseSeconds: null,
              medianLatestEditSeconds: null,
            },
            series: [],
            locations,
            providerTotals: {
              averageRating: null,
              totalReviewCount: null,
              localReviewCount: 4,
              divergence: false,
            },
          }),
          { headers: { "content-type": "application/json" } }
        )
    )
  )
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ReplyPerformanceTab />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ReplyPerformanceTab by-location card", () => {
  it("hides the by-location breakdown for a single-location org", async () => {
    // One row would just restate the stat tiles directly above it.
    stubOverview([locationRow("a", "Old Crown Girton")])
    renderTab()
    await screen.findByRole("heading", { name: "Review volume" })
    expect(
      screen.queryByRole("heading", { name: "By listing" })
    ).not.toBeInTheDocument()
  })

  it("shows the by-location breakdown once there is something to compare", async () => {
    stubOverview([locationRow("a", "Alpha"), locationRow("b", "Bravo")])
    renderTab()
    expect(
      await screen.findByRole("heading", { name: "By listing" })
    ).toBeInTheDocument()
  })
})

function overviewBody(reviewVolume = 4) {
  return {
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-01-31T00:00:00.000Z",
    timezone: "Europe/London",
    summary: {
      reviewVolume,
      averageRating: 4.5,
      responseRate: 80,
      unresolvedComplaints: 0,
      verificationFailures: 0,
      verificationRejectionRate: null,
      medianFirstResponseSeconds: 3600,
      p95FirstResponseSeconds: null,
      medianLatestEditSeconds: null,
    },
    series: [],
    locations: [locationRow("a", "Alpha"), locationRow("b", "Bravo")],
    providerTotals: {
      averageRating: null,
      totalReviewCount: null,
      localReviewCount: 4,
      divergence: false,
    },
  }
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })
const unavailable = () =>
  new Response(JSON.stringify({ error: "internal_error", message: "down" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  })

describe("ReplyPerformanceTab by-listing description", () => {
  it("says what Unresolved counts", async () => {
    stubOverview([locationRow("a", "Alpha"), locationRow("b", "Bravo")])
    renderTab()
    expect(
      await screen.findByText(
        "Highest response rate first. Unresolved counts 1- and 2-star reviews with no reply on Google."
      )
    ).toBeInTheDocument()
  })
})

describe("ReplyPerformanceTab failed loads", () => {
  it("keeps the figures, said to be the last load, when a background re-read fails", async () => {
    let fail = false
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (fail ? unavailable() : ok(overviewBody())))
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <ReplyPerformanceTab />
      </QueryClientProvider>
    )
    expect(await screen.findByText("Median response time")).toBeInTheDocument()
    fail = true
    await act(async () => {
      await client.refetchQueries()
    })
    expect(
      await screen.findByText("We couldn’t refresh these figures")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/The figures below are from the last successful load\.$/)
    ).toBeInTheDocument()
    // The figures stay: not swapped for the first-load error panel.
    expect(screen.getByText("Median response time")).toBeInTheDocument()
    expect(
      screen.queryByText("We could not load this report")
    ).not.toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    await vi.waitFor(() =>
      expect(
        screen.queryByText("We couldn’t refresh these figures")
      ).not.toBeInTheDocument()
    )
  })

  it("says when the earlier period could not be loaded, with a retry", async () => {
    // The earlier period's window ends where this one starts, weeks ago.
    let failPrevious = true
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const to = new URL(String(input), "http://x").searchParams.get("to")
      const earlier = to !== null && Date.parse(to) < Date.now() - 86_400_000
      return earlier && failPrevious ? unavailable() : ok(overviewBody())
    })
    vi.stubGlobal("fetch", fetchMock)
    renderTab()
    expect(
      await screen.findByText(
        "Changes against the 28 days before couldn’t be loaded."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/^Changes compare with/)).not.toBeInTheDocument()
    failPrevious = false
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByText(/^Changes compare with the 28 days before/)
    ).toBeInTheDocument()
  })
})

describe("ReplyPerformanceTab empty window", () => {
  it("shows one empty panel when neither window has reviews", async () => {
    stubOverview([], 0)
    renderTab()
    expect(
      await screen.findByText("No reviews in this period yet")
    ).toBeInTheDocument()
    expect(screen.queryByText("Response rate")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Review volume" })
    ).not.toBeInTheDocument()
  })
})

describe("ReplyLocationsTable nulls-last honest-null (spec §8)", () => {
  it("sorts rows with null response rate last and renders — for nulls", () => {
    render(
      <ReplyLocationsTable
        locations={[
          {
            id: "a",
            name: "Alpha",
            reviews: 3,
            averageRating: 4.2,
            responseRate: null,
            medianFirstResponseSeconds: null,
            p95FirstResponseSeconds: null,
            medianLatestEditSeconds: null,
            unresolvedComplaints: 0,
            verificationRejectionRate: null,
          },
          {
            id: "b",
            name: "Bravo",
            reviews: 9,
            averageRating: 4.8,
            responseRate: 91,
            medianFirstResponseSeconds: 3600,
            p95FirstResponseSeconds: null,
            medianLatestEditSeconds: null,
            unresolvedComplaints: 1,
            verificationRejectionRate: null,
          },
        ]}
      />
    )
    const rows = screen.getAllByRole("row").slice(1) // drop header
    expect(within(rows[0]).getByText("Bravo")).toBeInTheDocument() // non-null response rate first
    expect(within(rows[1]).getByText("Alpha")).toBeInTheDocument() // null last
    expect(within(rows[1]).getAllByText("—").length).toBeGreaterThan(0)
  })
})
