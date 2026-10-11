import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
  it("hands unknown future provider action types to Google without presenting confirmed ineligibility or an editor", () => {
    useBookingMock.mockReturnValue({ data: makeState({ supportedTypes: [], unsupportedTypes: ["FUTURE_ACTION"], links: [] }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("heading", { name: "Manage these action types in Google" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Manage action links in Google" })).toHaveAttribute("href", "https://business.google.com/")
    expect(screen.queryByRole("button", { name: "Review action link" })).not.toBeInTheDocument()
    expect(screen.queryByText("Google doesn’t offer action links for this listing")).not.toBeInTheDocument()
  })
  it("shows an observed empty location-specific action set without inventing enum-wide editors", () => {
    useBookingMock.mockReturnValue({ data: makeState({ supportedTypes: [], unsupportedTypes: [], links: [] }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("heading", { name: "Google doesn’t offer action links for this listing" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Review action link" })).not.toBeInTheDocument()
  })
  it("lists links, marks a non-editable provider link read-only, and shows no gate reason for a publisher", () => {
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("https://book.test")).toBeInTheDocument()
    expect(screen.getByText("Managed by Google")).toBeInTheDocument()
    // The add button exists; it is only disabled until a link is typed (dirty),
    // and a publisher sees no permission gate note.
    expect(screen.getByRole("button", { name: "Review action link" })).toBeInTheDocument()
    expect(screen.queryByText("You do not have permission to publish this location to Google.")).not.toBeInTheDocument()
  })

  it("disables adding with a reason when the viewer cannot publish", () => {
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.getByRole("button", { name: "Review action link" })).toBeDisabled()
    expect(screen.getByText("You do not have permission to publish this location to Google.")).toBeInTheDocument()
  })

  it("asks before closing the edit dialog with an unsaved link", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    await user.click(screen.getByRole("button", { name: "Edit the Reserve a table link" }))
    let dialog = await screen.findByRole("dialog")
    // Clean: Cancel closes at once.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()

    await user.click(screen.getByRole("button", { name: "Edit the Reserve a table link" }))
    dialog = await screen.findByRole("dialog")
    const link = within(dialog).getByRole("textbox", { name: "Link" })
    await user.clear(link)
    await user.type(link, "https://book.test/new")
    await user.keyboard("{Escape}")
    const prompt = await screen.findByRole("alertdialog", { name: "Close without saving?" })
    await user.click(within(prompt).getByRole("button", { name: "Keep editing" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Link" })).toHaveValue("https://book.test/new")

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Close and discard" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("asks before an in-app link leaves a typed new action link behind", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          {/* The sidebar's plain in-app link, outside the tab. */}
          <a href="/inbox">Inbox</a>
          <BookingTab locationId="loc-1" />
        </Toaster>
      </QueryClientProvider>
    )
    await user.type(screen.getByRole("textbox", { name: "Link" }), "https://order.test")
    const away = vi.fn((event: MouseEvent) => event.preventDefault())
    const inbox = screen.getByRole("link", { name: "Inbox" })
    inbox.addEventListener("click", away)
    await user.click(inbox)
    expect(away).not.toHaveBeenCalled()
    expect(await screen.findByRole("alertdialog", { name: "Leave without saving?" })).toBeInTheDocument()
  })
})
