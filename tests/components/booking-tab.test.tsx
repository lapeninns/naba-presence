import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BookingTab } from "@/components/locations/booking-tab"
import { Toaster } from "@/components/ui/toast"
import type { PlaceActionsState } from "@/lib/api/location-booking"

const useBookingMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-booking", () => ({ usePlaceActions: () => useBookingMock() }))
vi.mock("@/lib/queries/use-location-capabilities", () => ({ useLocationCapabilities: () => useCapsMock() }))

function makeState(overrides: Partial<PlaceActionsState> = {}): PlaceActionsState {
  return {
    locationId: "loc-1",
    canPublish: true,
    writesEnabled: true,
    supportedTypes: ["DINING_RESERVATION", "FOOD_ORDERING"],
    links: [
      { id: "l1", googleLinkName: "a/l/placeActionLinks/1", providerType: "MERCHANT", isEditable: true, uri: "https://book.test", placeActionType: "DINING_RESERVATION", isPreferred: true, googleHash: "h1", observedAt: "2026-07-01T00:00:00.000Z" },
      { id: "l2", googleLinkName: "a/l/placeActionLinks/2", providerType: "AGGREGATOR_3P", isEditable: false, uri: "https://third.test", placeActionType: "FOOD_ORDERING", isPreferred: false, googleHash: "h2", observedAt: "2026-07-01T00:00:00.000Z" },
    ],
    latestMutation: null,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster>
        <BookingTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
}

afterEach(() => vi.clearAllMocks())

describe("BookingTab", () => {
  it("lists links, marks a non-editable provider link read-only, and shows no gate reason for a publisher", () => {
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("https://book.test")).toBeInTheDocument()
    expect(screen.getByText("Managed by Google")).toBeInTheDocument()
    // The add button exists; it is only disabled until a link is typed (dirty),
    // and a publisher sees no permission gate note.
    expect(screen.getByRole("button", { name: "Add booking link" })).toBeInTheDocument()
    expect(screen.queryByText("You do not have permission to publish this location to Google.")).not.toBeInTheDocument()
  })

  it("disables adding with a reason when the viewer cannot publish", () => {
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("button", { name: "Add booking link" })).toBeDisabled()
    expect(screen.getByText("You do not have permission to publish this location to Google.")).toBeInTheDocument()
  })
})
