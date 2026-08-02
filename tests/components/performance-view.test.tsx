import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()
let search = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/performance",
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
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ from: "x", to: "y", timezone: "Europe/London", summary: { reviewVolume: 0, averageRating: null, responseRate: null, unresolvedComplaints: 0, verificationFailures: 0, verificationRejectionRate: null, medianFirstResponseSeconds: null, p95FirstResponseSeconds: null, medianLatestEditSeconds: null }, series: [], locations: [], providerTotals: { averageRating: null, totalReviewCount: null, localReviewCount: 0, divergence: false } }), { headers: { "content-type": "application/json" } })))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><PerformanceView /></QueryClientProvider>)
}

describe("PerformanceView", () => {
  it("exposes all three tabs and defaults to reply when tab is absent", () => {
    renderView()
    expect(screen.getByRole("tab", { name: "Reply performance" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "Google performance" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Keywords" })).toBeInTheDocument()
  })
  it("reflects ?tab=keywords as the active tab", () => {
    search = "tab=keywords"
    renderView()
    expect(screen.getByRole("tab", { name: "Keywords" })).toHaveAttribute("aria-selected", "true")
  })
})
