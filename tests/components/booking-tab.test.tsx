import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BookingTab } from "@/components/locations/booking-tab"
import { Toaster } from "@/components/ui/toast"
import type { PlaceActionsState } from "@/lib/api/location-booking"

const useBookingMock = vi.fn()
const useCapsMock = vi.fn()
const refreshPlaceActions = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, isError: false }))
vi.mock("@/lib/queries/use-location-booking", () => ({ usePlaceActions: () => useBookingMock(), useRefreshPlaceActions: () => refreshPlaceActions }))
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

afterEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
})

describe("BookingTab", () => {
  it("says when Google was last checked and checks it again on request", async () => {
    useBookingMock.mockReturnValue({ data: makeState({ observedAt: new Date(Date.now() - 2 * 60_000).toISOString(), source: "stored" }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText(/Checked with Google/)).toHaveTextContent("Checked with Google 2 minutes ago.")
    await userEvent.click(screen.getByRole("button", { name: "Check Google now" }))
    expect(refreshPlaceActions.mutate).toHaveBeenCalledOnce()
  })
  it("hands unknown future provider action types to Google without presenting confirmed ineligibility or an editor", () => {
    useBookingMock.mockReturnValue({ data: makeState({ supportedTypes: [], unsupportedTypes: ["FUTURE_ACTION"], links: [] }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("heading", { name: "Manage these action types in Google" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Manage booking links in Google" })).toHaveAttribute("href", "https://business.google.com/")
    expect(screen.queryByRole("button", { name: "Review booking link" })).not.toBeInTheDocument()
    expect(screen.queryByText("Google doesn’t offer booking links for this listing")).not.toBeInTheDocument()
  })
  it("shows an observed empty location-specific action set without inventing enum-wide editors", () => {
    useBookingMock.mockReturnValue({ data: makeState({ supportedTypes: [], unsupportedTypes: [], links: [] }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByRole("heading", { name: "Google doesn’t offer booking links for this listing" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Review booking link" })).not.toBeInTheDocument()
  })
  it("lists links, marks a non-editable provider link read-only, and shows no gate reason for a publisher", () => {
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getByText("https://book.test")).toBeInTheDocument()
    expect(screen.getByText("Managed by Google")).toBeInTheDocument()
    // The review action is docked once a link is typed, so none is on screen
    // yet, and a publisher sees no permission gate note.
    expect(screen.queryByRole("button", { name: "Review booking link" })).not.toBeInTheDocument()
    expect(screen.queryByText("You do not have permission to publish this location to Google.")).not.toBeInTheDocument()
  })

  it("disables adding with a reason when the viewer cannot publish", () => {
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: false, canPublish: false } })
    renderTab()
    expect(screen.queryByRole("button", { name: "Review booking link" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Type/ })).toBeDisabled()
    expect(screen.getByText("You do not have permission to publish this location to Google.")).toBeInTheDocument()
  })

  it("docks the review action once a link is typed", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.queryByRole("button", { name: "Review booking link" })).not.toBeInTheDocument()
    await user.type(screen.getByRole("textbox", { name: "Link" }), "https://book.example")
    const bar = screen.getByRole("region", { name: "Booking link actions" })
    expect(within(bar).getByRole("button", { name: "Review booking link" })).toBeEnabled()
  })

  it("shows the type as plain text when Google supports only one", () => {
    useBookingMock.mockReturnValue({ data: makeState({ supportedTypes: ["DINING_RESERVATION"] }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.queryByRole("button", { name: /^Type/ })).not.toBeInTheDocument()
    expect(screen.getAllByText("Reserve a table").length).toBeGreaterThan(0)
  })

  it("chooses the new link's type from a short option list", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    // A table reservation is the default; the row shows the chosen type.
    const typeRow = screen.getByRole("button", { name: /^Type/ })
    expect(typeRow).toHaveTextContent("Reserve a table")
    await user.click(typeRow)
    const picker = await screen.findByRole("listbox", { name: "Booking link type" })
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["Reserve a table", "Order online"])
    expect(within(picker).getByRole("option", { name: "Reserve a table" })).toHaveAttribute("aria-selected", "true")
    await user.click(within(picker).getByRole("option", { name: "Order online" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByRole("button", { name: /^Type/ })).toHaveTextContent("Order online")
  })

  it("asks before closing the edit dialog with an unsaved link", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({ data: makeState(), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    await user.click(screen.getByRole("button", { name: "Edit the Reserve a table link" }))
    let dialog = await screen.findByRole("dialog")
    // Clean: the ✕ closes at once, and there is no footer Cancel beside it.
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()

    await user.click(screen.getByRole("button", { name: "Edit the Reserve a table link" }))
    dialog = await screen.findByRole("dialog")
    const link = within(dialog).getByRole("textbox", { name: "Link" })
    await user.clear(link)
    await user.type(link, "https://book.test/new")
    // A reload warns; the edit is not kept in the tab, since nothing could
    // offer it back once the dialog is gone.
    const reload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    expect(Object.keys(sessionStorage).filter((key) => key.startsWith("naba:draft:"))).toEqual([])
    await user.keyboard("{Escape}")
    const prompt = await screen.findByRole("alertdialog", { name: "Close without saving?" })
    await user.click(within(prompt).getByRole("button", { name: "Keep editing" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Link" })).toHaveValue("https://book.test/new")

    await user.keyboard("{Escape}")
    await user.click(within(await screen.findByRole("alertdialog", { name: "Close without saving?" })).getByRole("button", { name: "Close and discard" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()

    // The ✕ with edits asks too: it is chrome, not a decision about them.
    await user.click(screen.getByRole("button", { name: "Edit the Reserve a table link" }))
    dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByRole("textbox", { name: "Link" }), "/again")
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await user.click(within(await screen.findByRole("alertdialog", { name: "Close without saving?" })).getByRole("button", { name: "Close and discard" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("keeps Edit visible and puts preferring and removing in an overflow menu, removal last and confirmed", async () => {
    const user = userEvent.setup()
    const second = { id: "l3", googleLinkName: "a/l/placeActionLinks/3", providerType: "MERCHANT", isEditable: true, uri: "https://book.test/other", placeActionType: "DINING_RESERVATION", isPreferred: false, googleHash: "h3", observedAt: "2026-07-01T00:00:00.000Z" } as const
    useBookingMock.mockReturnValue({ data: makeState({ links: [...makeState().links, second] }), isPending: false, isError: false, error: null, refetch: vi.fn() })
    useCapsMock.mockReturnValue({ data: { canEditCanonical: true, canPublish: true } })
    renderTab()
    expect(screen.getAllByRole("button", { name: "Edit the Reserve a table link" })).toHaveLength(2)
    expect(screen.queryByRole("button", { name: /Remove the/ })).toBeNull()
    const triggers = screen.getAllByRole("button", { name: "More actions for the Reserve a table link" })
    // The preferred link offers only removal.
    await user.click(triggers[0]!)
    let items = await screen.findAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual(["Remove link"])
    await user.keyboard("{Escape}")
    await user.click(triggers[1]!)
    items = await screen.findAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual(["Make preferred", "Remove link"])
    await user.click(screen.getByRole("menuitem", { name: "Remove link" }))
    const confirm = await screen.findByRole("alertdialog", { name: "Review removing this booking link?" })
    expect(within(confirm).getByText("https://book.test/other")).toBeInTheDocument()
    expect(within(confirm).getByRole("button", { name: "Prepare removal review" })).toBeEnabled()
  })

  it("asks before an in-app link leaves a typed new booking link behind", async () => {
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
