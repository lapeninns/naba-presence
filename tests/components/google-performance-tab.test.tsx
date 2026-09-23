import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/performance", useSearchParams: () => new URLSearchParams("tab=google") }))

import { GooglePerformanceTab } from "@/components/performance/google-performance-tab"

const ZERO_TOTALS = { BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 0, BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 0, BUSINESS_IMPRESSIONS_MOBILE_MAPS: 0, BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 0, CALL_CLICKS: 0, WEBSITE_CLICKS: 0, BUSINESS_DIRECTION_REQUESTS: 0, BUSINESS_CONVERSATIONS: 0, BUSINESS_BOOKINGS: 0, BUSINESS_FOOD_ORDERS: 0, BUSINESS_FOOD_MENU_CLICKS: 0 }

function stub(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })))
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><GooglePerformanceTab /></QueryClientProvider>)
}

describe("GooglePerformanceTab state mapping (D9)", () => {
  it("shows an off panel when ingestion is disabled", async () => {
    stub({ range: "28d", from: "a", to: "b", state: "empty", freshThrough: null, locations: [{ id: "l", name: "L" }], totals: ZERO_TOTALS, series: [], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: false })
    renderTab()
    expect(await screen.findByText(/not switched on|turned on|not enabled/i)).toBeInTheDocument()
  })
  it("shows a no-link panel when there is no linked location", async () => {
    stub({ range: "28d", from: "a", to: "b", state: "no_link", freshThrough: null, locations: [], totals: ZERO_TOTALS, series: [], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true })
    renderTab()
    expect(await screen.findByText(/no.*link|not linked|connect/i)).toBeInTheDocument()
  })
  it("humanises unavailable reasons without leaking a raw code", async () => {
    stub({ range: "28d", from: "a", to: "b", state: "unavailable", freshThrough: null, locations: [{ id: "l", name: "L" }], totals: ZERO_TOTALS, series: [], unavailableReasons: ["performance_sync_failed"], keywordsEnabled: false, ingestionEnabled: true })
    renderTab()
    expect(await screen.findByText(/did not return|retry/i)).toBeInTheDocument()
    expect(screen.queryByText(/performance_sync_failed/)).not.toBeInTheDocument()
  })
  it("renders metric tiles when ready", async () => {
    stub({ range: "28d", from: "a", to: "b", state: "ready", freshThrough: "2026-08-01", locations: [{ id: "l", name: "L" }], totals: { ...ZERO_TOTALS, CALL_CLICKS: 12, WEBSITE_CLICKS: 30 }, series: [{ date: "2026-08-01", metrics: { CALL_CLICKS: 12 } }], unavailableReasons: [], keywordsEnabled: false, ingestionEnabled: true })
    renderTab()
    // "Calls" and "Website clicks" also name the actions chart's series (its
    // legend and screen-reader table), so read the figure from the tile.
    const callsLabel = (await screen.findAllByText("Calls")).find((node) =>
      node.closest("[data-slot=kpi-tile]")
    )
    expect(callsLabel).toBeDefined()
    const tile = callsLabel!.closest("[data-slot=kpi-tile]") as HTMLElement
    expect(within(tile).getByText("12")).toBeInTheDocument()
    expect(screen.getAllByText("Website clicks").length).toBeGreaterThan(0)
  })
})
