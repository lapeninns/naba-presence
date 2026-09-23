import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
  it("renders each weekday and one primary action for an owner", () => {
    useHoursMock.mockReturnValue({ data: makeHours(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("Monday")).toBeInTheDocument()
    expect(screen.getByText("Sunday")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Review changes" })).toBeInTheDocument()
    // The two-button "Save changes / Publish to Google" pair is gone: nothing
    // reaches Google except through the review sheet.
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
  })

  it("names what would change on Google before anything is published", async () => {
    const user = userEvent.setup()
    useHoursMock.mockReturnValue({ data: makeHours(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()

    // Dirty the draft: close Monday, which Google currently has as closed too,
    // so open it a different way — change the opening time.
    const opensAt = screen.getByLabelText(/Monday.*opens/i)
    await user.clear(opensAt)
    await user.type(opensAt, "08:00")

    await user.click(screen.getByRole("button", { name: "Review changes" }))
    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByText("Monday")).toBeInTheDocument()
    expect(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    ).toBeInTheDocument()
  })

  it("disables editing for a viewer and says why", () => {
    useHoursMock.mockReturnValue({ data: makeHours({ writesEnabled: false }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    // The footer becomes the view-only bar: it explains, and offers no
    // actions at all rather than disabled ones.
    expect(screen.getByText(/View-only access\./)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Save here" })).toBeNull()
    expect(
      screen.getAllByText("Only owners and admins can edit this location.").length
    ).toBeGreaterThan(0)
  })

  it("keeps saving here available while publishing is paused, and says why", () => {
    useHoursMock.mockReturnValue({ data: makeHours(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({
      data: {
        canEditCanonical: true,
        canPublish: true,
        resources: { hours: { state: "readOnly", reasonCode: "publishing_paused" } },
      },
    })
    renderTab()
    expect(screen.getByText("Publishing to Google is paused for this listing")).toBeInTheDocument()
    expect(screen.getByText("publishing_paused")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled()
    // Saving here is not publishing: it stays available for an owner.
    expect(screen.getByRole("button", { name: "Save here" })).toBeInTheDocument()
  })

  it("points the validation summary at the field that needs fixing", async () => {
    const user = userEvent.setup()
    useHoursMock.mockReturnValue({ data: makeHours(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    const closes = screen.getByLabelText("Monday period 1 closes")
    await user.clear(closes)
    await user.type(closes, "09:00")
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    const summary = await screen.findByRole("alert", { name: /problem to fix/i })
    expect(summary).toHaveFocus()
    expect(within(summary).getByRole("link", { name: /Monday: Opening and closing times are the same/ })).toHaveAttribute("href", "#hours-1-0-opens")
    expect(screen.getByLabelText("Monday period 1 opens")).toHaveAttribute("aria-invalid", "true")
    // No sheet: nothing is offered for publishing while the draft is invalid.
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
