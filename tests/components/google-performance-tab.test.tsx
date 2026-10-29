import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/performance",
  useSearchParams: () => new URLSearchParams("tab=google"),
}))

let role: string | undefined
vi.mock("@/lib/queries/use-session", () => ({ useSessionRole: () => role }))

import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"
import { Toaster } from "@/components/ui/toast"

const ZERO_TOTALS = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 0,
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0,
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0,
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0,
  CALL_CLICKS: 0,
  WEBSITE_CLICKS: 0,
  BUSINESS_DIRECTION_REQUESTS: 0,
  BUSINESS_CONVERSATIONS: 0,
  BUSINESS_BOOKINGS: 0,
  BUSINESS_FOOD_ORDERS: 0,
  BUSINESS_FOOD_MENU_CLICKS: 0,
}

function stub(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json" },
        })
    )
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  role = undefined
})

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <GooglePerformanceTab />
    </QueryClientProvider>
  )
}

describe("GooglePerformanceTab state mapping (D9)", () => {
  it("shows an off panel when ingestion is disabled", async () => {
    stub({
      range: "28d",
      from: "a",
      to: "b",
      state: "empty",
      freshThrough: null,
      locations: [{ id: "l", name: "L" }],
      totals: ZERO_TOTALS,
      series: [],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: false,
    })
    renderTab()
    expect(
      await screen.findByText(/not switched on|turned on|not enabled/i)
    ).toBeInTheDocument()
  })
  it("shows a no-link panel when there is no linked listing", async () => {
    stub({
      range: "28d",
      from: "a",
      to: "b",
      state: "no_link",
      freshThrough: null,
      locations: [],
      totals: ZERO_TOTALS,
      series: [],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
    })
    renderTab()
    expect(
      await screen.findByText(/no.*link|not linked|connect/i)
    ).toBeInTheDocument()
  })
  it("humanises unavailable reasons without leaking a raw code", async () => {
    stub({
      range: "28d",
      from: "a",
      to: "b",
      state: "unavailable",
      freshThrough: null,
      locations: [{ id: "l", name: "L" }],
      totals: ZERO_TOTALS,
      series: [],
      unavailableReasons: ["performance_sync_failed"],
      keywordsEnabled: false,
      ingestionEnabled: true,
    })
    renderTab()
    expect(await screen.findByText(/did not return|retry/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/performance_sync_failed/)
    ).not.toBeInTheDocument()
  })
  it("renders metric tiles when ready", async () => {
    stub({
      range: "28d",
      from: "a",
      to: "b",
      state: "ready",
      freshThrough: "2026-08-01",
      locations: [{ id: "l", name: "L" }],
      totals: { ...ZERO_TOTALS, CALL_CLICKS: 12, WEBSITE_CLICKS: 30 },
      series: [{ date: "2026-08-01", metrics: { CALL_CLICKS: 12 } }],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
    })
    renderTab()
    // "Call button taps" and "Website clicks" also name the actions chart's
    // series (its legend and screen-reader table), so read the figure from the tile.
    const callsLabel = (await screen.findAllByText("Call button taps")).find(
      (node) => node.closest("[data-slot=kpi-tile]")
    )
    expect(callsLabel).toBeDefined()
    const tile = callsLabel!.closest("[data-slot=kpi-tile]") as HTMLElement
    expect(within(tile).getByText("12")).toBeInTheDocument()
    expect(screen.getAllByText("Website clicks").length).toBeGreaterThan(0)
  })
  it("shows missing metrics as no data, compares the previous period and states coverage", async () => {
    const totals = Object.fromEntries(
      Object.keys(ZERO_TOTALS).map((metric) => [metric, null])
    )
    stub({
      range: "28d",
      from: "2026-08-04",
      to: "2026-08-31",
      state: "ready",
      freshThrough: "2026-08-29",
      locations: [
        { id: "l", name: "L" },
        { id: "m", name: "M" },
      ],
      totals: { ...totals, CALL_CLICKS: 0, WEBSITE_CLICKS: 30 },
      series: [
        { date: "2026-08-29", metrics: { CALL_CLICKS: 0, WEBSITE_CLICKS: 30 } },
      ],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
      previous: {
        from: "2026-07-07",
        to: "2026-08-03",
        totals: { ...totals, WEBSITE_CLICKS: 20 },
      },
      fetchedAt: {
        oldest: "2026-08-30T06:00:00.000Z",
        newest: "2026-08-30T06:00:00.000Z",
      },
      coverage: {
        eligible: 2,
        reporting: 1,
        unavailable: 0,
        stale: 0,
        pending: 1,
        noData: 0,
      },
      dateBasis: "google_daily",
    })
    renderTab()
    const tileFor = async (label: string) =>
      (await screen.findAllByText(label))
        .find((node) => node.closest("[data-slot=kpi-tile]"))!
        .closest("[data-slot=kpi-tile]") as HTMLElement
    expect(
      within(await tileFor("Call button taps")).getByText("0")
    ).toBeInTheDocument()
    expect(
      within(await tileFor("Search views")).getByText("No data")
    ).toBeInTheDocument()
    expect(
      within(await tileFor("Website clicks")).getByText(/\+10|10/)
    ).toBeInTheDocument()
    // Provenance is one caption line; the detail is behind its info button.
    expect(
      screen.getByText("Through 29 Aug · 1 of 2 listings up to date")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Google’s daily dates/)).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "About these figures" })
    )
    const about = await screen.findByRole("dialog", {
      name: "About these figures",
    })
    expect(
      within(about).getByText(
        /1 of 2 listings up to date · 1 waiting for a first fetch/
      )
    ).toBeInTheDocument()
    expect(within(about).getByText(/Figures up to /)).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    expect(
      screen.getByRole("button", {
        name: "Download totals CSV of the Google profile",
      })
    ).toBeInTheDocument()
  })
  it("states expected vs covered listings and leaves a missing location out of the tiles", async () => {
    const totals = Object.fromEntries(
      Object.keys(ZERO_TOTALS).map((metric) => [metric, null])
    )
    stub({
      range: "28d",
      from: "2026-08-04",
      to: "2026-08-31",
      state: "ready",
      freshThrough: "2026-08-29",
      locations: [
        { id: "l", name: "Lamb" },
        { id: "m", name: "Mitre" },
        { id: "n", name: "Nags Head" },
      ],
      totals: { ...totals, CALL_CLICKS: 9 },
      series: [{ date: "2026-08-20", metrics: { CALL_CLICKS: 9 } }],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
      completeness: {
        state: "partial",
        expected: 3,
        covered: 2,
        completeThrough: "2026-08-20",
        missing: [{ id: "n", name: "Nags Head", reason: "pending" }],
        refreshFailed: [{ id: "m", name: "Mitre" }],
      },
    })
    renderTab()
    // One line in the report; the names and reasons are behind Details.
    const banner = (await screen.findByText("Showing 2 of 3 listings")).closest(
      "[data-slot=partial-coverage]"
    ) as HTMLElement
    expect(within(banner).queryByText(/Nags Head/)).not.toBeInTheDocument()
    await userEvent.click(
      within(banner).getByRole("button", { name: /^Details/ })
    )
    const details = await screen.findByRole("dialog", {
      name: "Showing 2 of 3 listings",
    })
    expect(
      within(details).getByText(/Not fetched from Google yet: Nags Head/)
    ).toBeInTheDocument()
    expect(
      within(details).getByText(/Latest refresh failed.*Mitre/)
    ).toBeInTheDocument()
    expect(within(details).getByText(/not counted as zero/)).toBeInTheDocument()
    expect(within(details).getByText(/through 20 Aug/)).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    const tileFor = async (label: string) =>
      (await screen.findAllByText(label))
        .find((node) => node.closest("[data-slot=kpi-tile]"))!
        .closest("[data-slot=kpi-tile]") as HTMLElement
    expect(
      within(await tileFor("Call button taps")).getByText("9")
    ).toBeInTheDocument()
    expect(
      within(await tileFor("Search views")).getByText("No data")
    ).toBeInTheDocument()
  })
  it("names every missing listing when the report covers none of them", async () => {
    stub({
      range: "28d",
      from: "2026-08-04",
      to: "2026-08-31",
      state: "empty",
      freshThrough: null,
      locations: [
        { id: "l", name: "Lamb" },
        { id: "m", name: "Mitre" },
      ],
      totals: ZERO_TOTALS,
      series: [],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
      completeness: {
        state: "none",
        expected: 2,
        covered: 0,
        completeThrough: null,
        missing: [
          { id: "l", name: "Lamb", reason: "stale" },
          { id: "m", name: "Mitre", reason: "pending" },
        ],
        refreshFailed: [],
      },
    })
    renderTab()
    const banner = (await screen.findByText("Showing 0 of 2 listings")).closest(
      "[data-slot=partial-coverage]"
    ) as HTMLElement
    await userEvent.click(
      within(banner).getByRole("button", { name: /^Details/ })
    )
    const details = await screen.findByRole("dialog", {
      name: "Showing 0 of 2 listings",
    })
    expect(
      within(details).getByText(/latest figures end before this period: Lamb/)
    ).toBeInTheDocument()
    expect(
      within(details).getByText(/Not fetched from Google yet: Mitre/)
    ).toBeInTheDocument()
    expect(
      within(details).getByText(/none is counted as zero/)
    ).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    expect(screen.getByText("No activity yet")).toBeInTheDocument()
  })
  it("names a failed refresh once, inside the alert that says why", async () => {
    const totals = Object.fromEntries(
      Object.keys(ZERO_TOTALS).map((metric) => [metric, null])
    )
    stub({
      range: "28d",
      from: "2026-08-04",
      to: "2026-08-31",
      state: "ready",
      freshThrough: "2026-08-29",
      locations: [
        { id: "l", name: "Lamb" },
        { id: "m", name: "Mitre" },
      ],
      totals: { ...totals, CALL_CLICKS: 9 },
      series: [{ date: "2026-08-20", metrics: { CALL_CLICKS: 9 } }],
      unavailableReasons: ["performance_sync_failed"],
      keywordsEnabled: false,
      ingestionEnabled: true,
      completeness: {
        state: "partial",
        expected: 2,
        covered: 2,
        completeThrough: "2026-08-20",
        missing: [],
        refreshFailed: [{ id: "m", name: "Mitre" }],
      },
    })
    renderTab()
    const alert = (
      await screen.findByText("Some figures could not be refreshed")
    ).closest("[data-slot=unavailable-reasons]") as HTMLElement
    expect(
      within(alert).getByText(/Latest refresh failed.*Mitre.*through 20 Aug/)
    ).toBeInTheDocument()
    expect(document.querySelector("[data-slot=partial-coverage]")).toBeNull()
  })
})

describe("GooglePerformanceTab says what is true", () => {
  function renderAsOwner() {
    role = "owner"
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          <GooglePerformanceTab />
        </Toaster>
      </QueryClientProvider>
    )
    return client
  }

  it("does not offer a refresh the server would refuse while Google performance is off, nor send anyone to an admin", async () => {
    stub({
      range: "28d",
      from: "a",
      to: "b",
      state: "empty",
      freshThrough: null,
      locations: [{ id: "l", name: "L" }],
      totals: ZERO_TOTALS,
      series: [],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: false,
    })
    renderAsOwner()
    expect(
      await screen.findByText("Google performance is not switched on")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/isn’t a setting in your organisation/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Ask an admin/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "More actions" })
    ).not.toBeInTheDocument()
  })

  it("still offers an owner the refresh when Google performance is on", async () => {
    stub({
      range: "28d",
      from: "a",
      to: "b",
      state: "empty",
      freshThrough: null,
      locations: [{ id: "l", name: "L" }],
      totals: ZERO_TOTALS,
      series: [],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
    })
    renderAsOwner()
    expect(await screen.findByText("No activity yet")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "More actions" })
    ).toBeInTheDocument()
  })

  it('does not say "some" when nothing could be refreshed', async () => {
    stub({
      range: "28d",
      from: "a",
      to: "b",
      state: "unavailable",
      freshThrough: null,
      locations: [{ id: "l", name: "L" }],
      totals: ZERO_TOTALS,
      series: [],
      unavailableReasons: ["performance_sync_failed"],
      keywordsEnabled: false,
      ingestionEnabled: true,
    })
    renderTab()
    expect(
      await screen.findByText("Google figures could not be refreshed")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Some figures could not be refreshed")
    ).not.toBeInTheDocument()
  })

  it("keeps the figures, said to be the last load, when a background re-read fails", async () => {
    let fail = false
    const body = {
      range: "28d",
      from: "2026-08-04",
      to: "2026-08-31",
      state: "ready",
      freshThrough: "2026-08-29",
      locations: [{ id: "l", name: "L" }],
      totals: { ...ZERO_TOTALS, CALL_CLICKS: 12 },
      series: [{ date: "2026-08-01", metrics: { CALL_CLICKS: 12 } }],
      unavailableReasons: [],
      keywordsEnabled: false,
      ingestionEnabled: true,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fail
          ? new Response(
              JSON.stringify({ error: "internal_error", message: "down" }),
              { status: 503, headers: { "content-type": "application/json" } }
            )
          : new Response(JSON.stringify(body), {
              headers: { "content-type": "application/json" },
            })
      )
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <GooglePerformanceTab />
      </QueryClientProvider>
    )
    expect(
      (await screen.findAllByText("Call button taps")).length
    ).toBeGreaterThan(0)
    fail = true
    await act(async () => {
      await client.refetchQueries()
    })
    expect(
      await screen.findByText("We couldn’t refresh these figures")
    ).toBeInTheDocument()
    expect(screen.getAllByText("Call button taps").length).toBeGreaterThan(0)
    expect(
      screen.queryByText("We could not load this report")
    ).not.toBeInTheDocument()
  })
})
