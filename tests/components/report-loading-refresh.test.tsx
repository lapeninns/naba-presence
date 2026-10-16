import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams("locationId=loc-1"),
}))
vi.mock("@/lib/queries/use-session", () => ({
  useSessionRole: () => "owner",
}))

import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"
import { KeywordsTab } from "@/components/performance/keywords-tab"
import { LocationReport } from "@/components/performance/location-report"
import { ReportsSkeleton } from "@/components/reporting/reports-skeleton"
import { Toaster } from "@/components/ui/toast"

const TOTALS = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 1,
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 1,
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 1,
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 1,
  CALL_CLICKS: 1,
  WEBSITE_CLICKS: 1,
  BUSINESS_DIRECTION_REQUESTS: 1,
  BUSINESS_CONVERSATIONS: 1,
  BUSINESS_BOOKINGS: 1,
  BUSINESS_FOOD_ORDERS: 1,
  BUSINESS_FOOD_MENU_CLICKS: 1,
}

function presence(fetchedAt: string) {
  return {
    range: "28d",
    from: "2026-08-04",
    to: "2026-08-31",
    state: "ready",
    freshThrough: "2026-08-29",
    locations: [{ id: "l", name: "L" }],
    totals: TOTALS,
    series: [{ date: "2026-08-29", metrics: { CALL_CLICKS: 1 } }],
    unavailableReasons: [],
    keywordsEnabled: false,
    ingestionEnabled: true,
    fetchedAt: { oldest: fetchedAt, newest: fetchedAt },
    coverage: {
      eligible: 1,
      reporting: 1,
      unavailable: 0,
      stale: 0,
      pending: 0,
    },
  }
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  })

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  replace.mockReset()
})

describe("ReportsSkeleton tab shapes", () => {
  it("draws Google's five tiles and two charts", () => {
    const { container } = render(
      <ReportsSkeleton variant="google" label="Loading visibility figures…" />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading visibility figures…"
    )
    expect(container.querySelectorAll("[data-skeleton=tile]")).toHaveLength(5)
    expect(container.querySelectorAll("[data-skeleton=chart]")).toHaveLength(2)
    expect(container.querySelectorAll("[data-skeleton=record]")).toHaveLength(0)
  })

  it("draws the keywords' record cards and no tiles", () => {
    const { container } = render(
      <ReportsSkeleton variant="keywords" label="Loading keywords…" />
    )
    expect(
      container.querySelectorAll("[data-skeleton=record]").length
    ).toBeGreaterThan(3)
    expect(container.querySelectorAll("[data-skeleton=tile]")).toHaveLength(0)
  })
})

describe("tab loading", () => {
  it("shows the Google tab's shape, with the caption's room kept, until the figures answer", async () => {
    let answer: (response: Response) => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)))
    )
    const { container } = render(
      <QueryClientProvider client={client()}>
        <Toaster>
          <GooglePerformanceTab />
        </Toaster>
      </QueryClientProvider>
    )
    expect(container.querySelectorAll("[data-skeleton=tile]")).toHaveLength(5)
    expect(
      container.querySelector("[data-slot=report-tab-head]")
    ).toBeInTheDocument()
    // The report's actions menu is there from the first paint, and Refresh
    // from Google is its row.
    await userEvent.click(screen.getByRole("button", { name: "More actions" }))
    expect(
      await screen.findByRole("menuitem", { name: "Refresh from Google" })
    ).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await act(async () => answer(json(presence("2026-08-30T06:00:00.000Z"))))
    expect(await screen.findByText(/^Through 29 Aug/)).toBeInTheDocument()
    expect(container.querySelectorAll("[data-skeleton=tile]")).toHaveLength(0)
  })

  it("shows the keywords' shape while they load", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    )
    const { container } = render(
      <QueryClientProvider client={client()}>
        <Toaster>
          <KeywordsTab />
        </Toaster>
      </QueryClientProvider>
    )
    expect(
      container.querySelectorAll("[data-skeleton=record]").length
    ).toBeGreaterThan(3)
  })
})

describe("refreshing from Google", () => {
  it("shows Refreshing… and re-reads the figures until they change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let fetchedAt = "2026-08-30T06:00:00.000Z"
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ organisations: [] })
      return json(presence(fetchedAt))
    })
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <QueryClientProvider client={client()}>
        <Toaster>
          <GooglePerformanceTab />
        </Toaster>
      </QueryClientProvider>
    )
    await screen.findByText(/^Through 29 Aug/)
    const reads = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith("/api/analytics/presence") &&
          init?.method !== "POST"
      ).length
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Refresh from Google" })
    )
    // One invalidate, no second explicit refetch: the figures are read twice
    // in all (the load, then the press).
    await waitFor(() => expect(reads()).toBe(2))
    expect(await screen.findByText("Refreshing…")).toBeInTheDocument()

    // Nothing has changed yet: it reads again after five seconds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await waitFor(() => expect(reads()).toBe(3))
    expect(screen.getByText("Refreshing…")).toBeInTheDocument()

    // Google's new figures arrive: the status clears and polling stops.
    fetchedAt = "2026-08-30T07:00:00.000Z"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await waitFor(() =>
      expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument()
    )
    const settled = reads()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(reads()).toBe(settled)
  })

  // The keywords response has no fetch time, so unchanged terms cannot be told
  // from a sync still running: the wait is short and ends on its own.
  it("stops following a keywords refresh after 30 seconds when the terms never change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ organisations: [] })
        : json({
            range: "6m",
            from: "2026-03-01",
            state: "ready",
            locations: [{ id: "l", name: "L" }],
            keywords: [
              {
                rank: 1,
                keyword: "riverside hotel bath",
                impressions: 5200,
                upperBound: 5200,
                thresholded: false,
                firstMonth: "2026-03",
                latestMonth: "2026-08",
              },
            ],
            unavailableReasons: [],
          })
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <QueryClientProvider client={client()}>
        <Toaster>
          <KeywordsTab />
        </Toaster>
      </QueryClientProvider>
    )
    await screen.findByText("riverside hotel bath")
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Refresh from Google" })
    )
    expect(await screen.findByText("Refreshing…")).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000)
    })
    expect(screen.getByText("Refreshing…")).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await waitFor(() =>
      expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument()
    )
  })

  it("stops waiting when the request fails", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(
            JSON.stringify({ error: "sync_in_progress", message: "busy" }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            }
          )
        : json(presence("2026-08-30T06:00:00.000Z"))
    )
    vi.stubGlobal("fetch", fetchMock)
    render(
      <QueryClientProvider client={client()}>
        <Toaster>
          <GooglePerformanceTab />
        </Toaster>
      </QueryClientProvider>
    )
    await screen.findByText(/^Through 29 Aug/)
    await userEvent.click(screen.getByRole("button", { name: "More actions" }))
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Refresh from Google" })
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already running/
    )
    expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument()
  })
})

describe("one location's report", () => {
  it("starts the figure queries without waiting for the location directory", async () => {
    const fetchMock = vi.fn((url: string) =>
      String(url).startsWith("/api/analytics")
        ? Promise.resolve(
            json(
              String(url).includes("/presence")
                ? presence("2026-08-30T06:00:00.000Z")
                : {}
            )
          )
        : new Promise<Response>(() => {})
    )
    vi.stubGlobal("fetch", fetchMock)
    render(
      <QueryClientProvider client={client()}>
        <LocationReport locationId="loc-1" />
      </QueryClientProvider>
    )
    expect(
      screen.getByText("Loading this location’s report")
    ).toBeInTheDocument()
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url))
      expect(
        urls.some((url) => url.startsWith("/api/analytics/overview"))
      ).toBe(true)
      expect(
        urls.some(
          (url) =>
            url.startsWith("/api/analytics/presence?") &&
            url.includes("locationId=loc-1")
        )
      ).toBe(true)
    })
    // The directory is still out, and the figures are already drawing.
    expect(await screen.findByText("Visibility on Google")).toBeInTheDocument()
  })
})
