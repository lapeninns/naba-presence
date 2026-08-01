import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { HoursTab } from "@/components/locations/hours-tab"
import { Toaster } from "@/components/ui/toast"
import { emptyHours } from "@/lib/locations/forms/hours"
import type { HoursState } from "@/lib/api/location-hours"

const useHoursMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-hours", () => ({ useHours: () => useHoursMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeHours(overrides: Partial<HoursState> = {}): HoursState {
  const canonical = emptyHours()
  canonical.regular[1] = { dayOfWeek: 1, isClosed: false, periods: [{ opensAt: "09:00", closesAt: "17:00" }] }
  return {
    location: { id: "loc-1", name: "Riverside", googleLocationName: "locations/1", timezone: "Europe/London" },
    canonicalResource: { revision: "2", updatedAt: "2026-08-01T00:00:00.000Z" },
    status: "core_dirty",
    canonical,
    google: emptyHours(),
    canonicalHash: "ch",
    googleHash: "gh",
    updateMask: ["regularHours"],
    warnings: [],
    canPublish: true,
    writesEnabled: true,
    lastReconciledAt: null,
    latestAttempt: null,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <HoursTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("HoursTab", () => {
  it("renders each weekday and Monday's open time for an owner", () => {
    useHoursMock.mockReturnValue({ data: makeHours(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("Monday")).toBeInTheDocument()
    expect(screen.getByText("Sunday")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
  })

  it("disables editing for a viewer and publish when writes are off", () => {
    useHoursMock.mockReturnValue({ data: makeHours({ writesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    expect(screen.getByText("Only owners and admins can edit this location.")).toBeInTheDocument()
  })
})
