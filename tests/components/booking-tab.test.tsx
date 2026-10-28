import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { mockWebkitShortSeptember } from "../helpers/webkit-short-month"
import { BookingTab } from "@/components/locations/booking-tab"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { PlaceActionsState } from "@/lib/api/location-booking"

const previewReview = vi.hoisted(() => vi.fn())
const approveReview = vi.hoisted(() => vi.fn())
const sendReview = vi.hoisted(() => vi.fn())
const savedWork = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api/place-action-reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/place-action-reviews")>()),
  previewPlaceActionReview: previewReview,
  approvePlaceActionReview: approveReview,
  sendPlaceActionReview: sendReview,
  fetchPlaceActionWorkflows: savedWork,
}))

const useBookingMock = vi.fn()
const useCapsMock = vi.fn()
const refreshPlaceActions = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
}))
vi.mock("@/lib/queries/use-location-booking", () => ({
  usePlaceActions: () => useBookingMock(),
  useRefreshPlaceActions: () => refreshPlaceActions,
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => useCapsMock(),
}))

function makeState(
  overrides: Partial<PlaceActionsState> = {}
): PlaceActionsState {
  return {
    locationId: "loc-1",
    canPublish: true,
    writesEnabled: true,
    supportedTypes: ["DINING_RESERVATION", "FOOD_ORDERING"],
    links: [
      {
        id: "l1",
        googleLinkName: "a/l/placeActionLinks/1",
        providerType: "MERCHANT",
        isEditable: true,
        uri: "https://book.test",
        placeActionType: "DINING_RESERVATION",
        isPreferred: true,
        googleHash: "h1",
        observedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "l2",
        googleLinkName: "a/l/placeActionLinks/2",
        providerType: "AGGREGATOR_3P",
        isEditable: false,
        uri: "https://third.test",
        placeActionType: "FOOD_ORDERING",
        isPreferred: false,
        googleHash: "h2",
        observedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    latestMutation: null,
    ...overrides,
  }
}

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  sessionStorage.clear()
})

describe("BookingTab", () => {
  it.each([
    ["America/Los_Angeles", "Checked on Google 30 Sept"],
    ["Asia/Tokyo", "Checked on Google 1 Oct"],
  ])(
    "keeps an observed date on the runtime's %s clock without a year",
    (zone, expected) => {
      vi.stubEnv("TZ", zone)
      mockWebkitShortSeptember()
      const state = makeState()
      state.links[0]!.observedAt = "2026-10-01T00:30:00Z"
      useBookingMock.mockReturnValue({
        data: state,
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      })
      useCapsMock.mockReturnValue({
        data: { canEditCanonical: true, canPublish: true },
      })
      renderTab()
      expect(screen.getByText(expected)).toBeInTheDocument()
    }
  )

  it("omits the observed note when Google's observed timestamp is invalid", () => {
    const state = makeState()
    state.links[0]!.observedAt = "invalid"
    useBookingMock.mockReturnValue({
      data: state,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.queryByText(/^Checked on Google/)).toBeNull()
    expect(screen.getByText("https://book.test")).toBeInTheDocument()
  })

  it("says when Google was last checked and checks it again on request", async () => {
    useBookingMock.mockReturnValue({
      data: makeState({
        observedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
        source: "stored",
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.getByText(/Checked with Google/)).toHaveTextContent(
      "Checked with Google 2 minutes ago."
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Check Google now" })
    )
    expect(refreshPlaceActions.mutate).toHaveBeenCalledOnce()
  })
  it("hands unknown future provider action types to Google without presenting confirmed ineligibility or an editor", () => {
    useBookingMock.mockReturnValue({
      data: makeState({
        supportedTypes: [],
        unsupportedTypes: ["FUTURE_ACTION"],
        links: [],
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByRole("heading", {
        name: "Manage these action types in Google",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Manage booking links in Google" })
    ).toHaveAttribute("href", "https://business.google.com/")
    expect(
      screen.queryByRole("button", { name: "Review booking link" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("Google doesn’t offer booking links for this listing")
    ).not.toBeInTheDocument()
  })
  it("shows an observed empty location-specific action set without inventing enum-wide editors", () => {
    useBookingMock.mockReturnValue({
      data: makeState({ supportedTypes: [], unsupportedTypes: [], links: [] }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByRole("heading", {
        name: "Google doesn’t offer booking links for this listing",
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Review booking link" })
    ).not.toBeInTheDocument()
  })
  it("lists links, marks a non-editable provider link read-only, and shows no gate reason for a publisher", () => {
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.getByText("https://book.test")).toBeInTheDocument()
    expect(screen.getByText("Managed by Google")).toBeInTheDocument()
    // The review action is docked once a link is typed, so none is on screen
    // yet, and a publisher sees no permission gate note.
    expect(
      screen.queryByRole("button", { name: "Review booking link" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        "You do not have permission to publish this location to Google."
      )
    ).not.toBeInTheDocument()
  })

  it("shows links read-only to a viewer: no add form, no row actions, and says who can help", () => {
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: false, canPublish: false },
    })
    renderTab()
    expect(screen.getByText("https://book.test")).toBeInTheDocument()
    expect(
      screen.getByText("You can look, but not change these links")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "You do not have permission to publish this location to Google. Ask an owner or admin if something here needs to change."
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Add a booking link" })
    ).toBeNull()
    expect(screen.queryByRole("textbox", { name: /^Link/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /^Type/ })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Edit the Reserve a table link" })
    ).toBeNull()
    expect(
      screen.queryByRole("button", {
        name: "More actions for the Reserve a table link",
      })
    ).toBeNull()
  })

  it("tells a viewer the listing has no booking links, not to add one", () => {
    useBookingMock.mockReturnValue({
      data: makeState({ links: [] }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: false, canPublish: false },
    })
    renderTab()
    expect(
      screen.getByRole("heading", { name: "No booking links yet" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("Google shows no booking links on this listing.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Add a booking link below/)).toBeNull()
  })

  it("keeps the full editor for a member who can publish", () => {
    useBookingMock.mockReturnValue({
      data: makeState({ links: [] }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: false, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByText(
        "Add a booking link below. Google decides how it appears publicly."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: /^Link/ })).toBeEnabled()
    expect(screen.queryByText(/You can look, but not change/)).toBeNull()
  })

  it("keeps the disabled form beside the reason for an owner held back by publishing", () => {
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: false },
    })
    renderTab()
    expect(screen.getByRole("button", { name: /^Type/ })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Edit the Reserve a table link" })
    ).toBeDisabled()
    expect(
      screen.getByText(
        "You do not have permission to publish this location to Google."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Ask an owner or admin/)).toBeNull()
  })

  it("says what the link field takes before a mistake, in the add form and the edit dialog", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByRole("textbox", { name: "Link" })
    ).toHaveAccessibleDescription(
      "The full address of your booking page, starting with https://"
    )
    await user.click(
      screen.getByRole("button", { name: "Edit the Reserve a table link" })
    )
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByRole("textbox", { name: "Link" })
    ).toHaveAccessibleDescription(
      "The full address of your booking page, starting with https://"
    )
  })

  it("names the last change in words, and sends an owner to the saved work when it needs a check", () => {
    useBookingMock.mockReturnValue({
      data: makeState({
        latestMutation: {
          id: "m1",
          operation: "delete",
          status: "ambiguous",
          createdAt: "2026-07-01T00:00:00.000Z",
          finishedAt: null,
        },
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getByText(
        /The last change \(removing a link\) has no confirmed outcome\./
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Go to saved booking link work" })
    ).toHaveAttribute("href", "#saved-booking-link-work")
  })

  it("names a failed last change in words", () => {
    useBookingMock.mockReturnValue({
      data: makeState({
        latestMutation: {
          id: "m1",
          operation: "CREATE",
          status: "failed",
          createdAt: "2026-07-01T00:00:00.000Z",
          finishedAt: null,
        },
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: false, canPublish: false },
    })
    renderTab()
    expect(
      screen.getByText(/The last change \(adding a link\) failed\./)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Go to saved booking link work" })
    ).toBeNull()
  })

  it("pauses changes after a lost send and opens its saved outcome from the alert", async () => {
    const user = userEvent.setup()
    const changeSet = {
      id: "11111111-1111-4111-8111-111111111111",
      locationName: "Fixture",
      targetResourceName: "locations/fixture",
      payloadHash: "b".repeat(64),
      baselineHash: "a".repeat(64),
      payload: {
        request: {
          operation: "create",
          payload: {
            uri: "https://book.example",
            placeActionType: "DINING_RESERVATION",
            isPreferred: false,
          },
        },
        connectionId: "33333333-3333-4333-8333-333333333333",
        credentialGeneration: 1,
        observedAt: "2026-09-30T10:00:00Z",
      },
      baseline: {
        collection: "locations/fixture/placeActionLinks",
        supportedTypes: ["DINING_RESERVATION"],
        unsupportedTypes: [],
        links: [],
      },
      updateMask: [],
      requestedBy: "owner",
      approvedBy: null,
      requiresSecondApprover: false,
      canApprove: true,
      expiresAt: "2099-01-01T12:00:00Z",
    }
    const review = (approvedBy: string | null) => ({
      changeSet: { ...changeSet, approvedBy },
      request: changeSet.payload.request,
      target: "locations/fixture",
      observedAt: "2026-09-30T10:00:00Z",
    })
    previewReview.mockResolvedValue(review(null))
    approveReview.mockResolvedValue(review("owner"))
    sendReview.mockRejectedValue(new Error("Lost response"))
    savedWork.mockResolvedValue({ items: [], nextCursor: null })
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    await user.type(
      screen.getByRole("textbox", { name: "Link" }),
      "https://book.example"
    )
    await user.click(
      within(
        screen.getByRole("region", { name: "Booking link actions" })
      ).getByRole("button", { name: "Review booking link" })
    )
    let sheet = await screen.findByRole("dialog", {
      name: "Review booking link change",
    })
    await user.click(
      within(sheet).getByRole("button", { name: "Approve booking link change" })
    )
    await user.click(
      await within(sheet).findByRole("checkbox", {
        name: "Send this exact approved booking link change to Google.",
      })
    )
    await user.click(
      within(sheet).getByRole("button", {
        name: "Send approved booking link change",
      })
    )
    sheet = await screen.findByRole("dialog", {
      name: "Saved booking link outcome",
    })
    await user.click(
      within(sheet).getByRole("button", { name: "Close for now" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    expect(
      screen.getByText("Booking link changes are paused")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Open the saved outcome and check it on Google before another booking link change."
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Open saved outcome" }))
    expect(
      await screen.findByRole("dialog", { name: "Saved booking link outcome" })
    ).toBeInTheDocument()
    expect(sendReview).toHaveBeenCalledOnce()
  })

  it("docks the review action once a link is typed", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.queryByRole("button", { name: "Review booking link" })
    ).not.toBeInTheDocument()
    await user.type(
      screen.getByRole("textbox", { name: "Link" }),
      "https://book.example"
    )
    const bar = screen.getByRole("region", { name: "Booking link actions" })
    expect(
      within(bar).getByRole("button", { name: "Review booking link" })
    ).toBeEnabled()
  })

  // The focused button used to unmount while the review was prepared, so
  // focus fell to the page and a failed review left it there.
  it("keeps the review action mounted, and focused, while the review is prepared and after it fails", async () => {
    const user = userEvent.setup()
    let fail!: (error: Error) => void
    previewReview.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      })
    )
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    await user.type(
      screen.getByRole("textbox", { name: "Link" }),
      "https://book.example"
    )
    const bar = screen.getByRole("region", { name: "Booking link actions" })
    const review = within(bar).getByRole("button", {
      name: "Review booking link",
    })
    review.focus()
    await user.keyboard("{Enter}")

    // Pending: the same button is still there, still focused, and says so.
    await waitFor(() => expect(previewReview).toHaveBeenCalledOnce())
    const pending = within(
      screen.getByRole("region", { name: "Booking link actions" })
    ).getByRole("button", { name: /Preparing review/ })
    expect(pending).toBe(review)
    expect(document.activeElement).toBe(review)

    fail(
      new ApiClientError(
        502,
        "google_unavailable",
        "Google could not be reached."
      )
    )
    expect(
      await screen.findByText("Google could not be reached.")
    ).toBeInTheDocument()
    const again = within(
      screen.getByRole("region", { name: "Booking link actions" })
    ).getByRole("button", { name: "Review booking link" })
    expect(again).toBe(review)
    expect(document.activeElement).toBe(review)
  })

  it("shows the type as plain text when Google supports only one", () => {
    useBookingMock.mockReturnValue({
      data: makeState({ supportedTypes: ["DINING_RESERVATION"] }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.queryByRole("button", { name: /^Type/ })
    ).not.toBeInTheDocument()
    expect(screen.getAllByText("Reserve a table").length).toBeGreaterThan(0)
  })

  it("chooses the new link's type from a short option list", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    // A table reservation is the default; the row shows the chosen type.
    const typeRow = screen.getByRole("button", { name: /^Type/ })
    expect(typeRow).toHaveTextContent("Reserve a table")
    await user.click(typeRow)
    const picker = await screen.findByRole("listbox", {
      name: "Booking link type",
    })
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Reserve a table", "Order online"])
    expect(
      within(picker).getByRole("option", { name: "Reserve a table" })
    ).toHaveAttribute("aria-selected", "true")
    await user.click(
      within(picker).getByRole("option", { name: "Order online" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByRole("button", { name: /^Type/ })).toHaveTextContent(
      "Order online"
    )
  })

  it("asks before closing the edit dialog with an unsaved link", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    await user.click(
      screen.getByRole("button", { name: "Edit the Reserve a table link" })
    )
    let dialog = await screen.findByRole("dialog")
    // Clean: the ✕ closes at once, and there is no footer Cancel beside it.
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()

    await user.click(
      screen.getByRole("button", { name: "Edit the Reserve a table link" })
    )
    dialog = await screen.findByRole("dialog")
    const link = within(dialog).getByRole("textbox", { name: "Link" })
    await user.clear(link)
    await user.type(link, "https://book.test/new")
    // A reload warns; the edit is not kept in the tab, since nothing could
    // offer it back once the dialog is gone.
    const reload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    expect(
      Object.keys(sessionStorage).filter((key) => key.startsWith("naba:draft:"))
    ).toEqual([])
    await user.keyboard("{Escape}")
    const prompt = await screen.findByRole("alertdialog", {
      name: "Close without saving?",
    })
    await user.click(
      within(prompt).getByRole("button", { name: "Keep editing" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(
      within(screen.getByRole("dialog")).getByRole("textbox", { name: "Link" })
    ).toHaveValue("https://book.test/new")

    await user.keyboard("{Escape}")
    await user.click(
      within(
        await screen.findByRole("alertdialog", {
          name: "Close without saving?",
        })
      ).getByRole("button", { name: "Close and discard" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()

    // The ✕ with edits asks too: it is chrome, not a decision about them.
    await user.click(
      screen.getByRole("button", { name: "Edit the Reserve a table link" })
    )
    dialog = await screen.findByRole("dialog")
    await user.type(
      within(dialog).getByRole("textbox", { name: "Link" }),
      "/again"
    )
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await user.click(
      within(
        await screen.findByRole("alertdialog", {
          name: "Close without saving?",
        })
      ).getByRole("button", { name: "Close and discard" })
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("keeps Edit visible and puts preferring and removing in an overflow menu, removal last and confirmed", async () => {
    const user = userEvent.setup()
    const second = {
      id: "l3",
      googleLinkName: "a/l/placeActionLinks/3",
      providerType: "MERCHANT",
      isEditable: true,
      uri: "https://book.test/other",
      placeActionType: "DINING_RESERVATION",
      isPreferred: false,
      googleHash: "h3",
      observedAt: "2026-07-01T00:00:00.000Z",
    } as const
    useBookingMock.mockReturnValue({
      data: makeState({ links: [...makeState().links, second] }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(
      screen.getAllByRole("button", { name: "Edit the Reserve a table link" })
    ).toHaveLength(2)
    expect(screen.queryByRole("button", { name: /Remove the/ })).toBeNull()
    const triggers = screen.getAllByRole("button", {
      name: "More actions for the Reserve a table link",
    })
    // The preferred link offers only removal.
    await user.click(triggers[0]!)
    let items = await screen.findAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual(["Remove link"])
    await user.keyboard("{Escape}")
    await user.click(triggers[1]!)
    items = await screen.findAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "Make preferred",
      "Remove link",
    ])
    await user.click(screen.getByRole("menuitem", { name: "Remove link" }))
    const confirm = await screen.findByRole("alertdialog", {
      name: "Remove this Reserve a table link?",
    })
    expect(
      within(confirm).getByText("https://book.test/other")
    ).toBeInTheDocument()
    expect(
      within(confirm).getByText(
        /You review and approve the removal before it’s sent\./
      )
    ).toBeInTheDocument()
    expect(
      within(confirm).getByRole("button", { name: "Review removal" })
    ).toBeEnabled()
  })

  it("asks before an in-app link leaves a typed new booking link behind", async () => {
    const user = userEvent.setup()
    useBookingMock.mockReturnValue({
      data: makeState(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <Toaster>
          {/* The sidebar's plain in-app link, outside the tab. */}
          <a href="/inbox">Inbox</a>
          <BookingTab locationId="loc-1" />
        </Toaster>
      </QueryClientProvider>
    )
    await user.type(
      screen.getByRole("textbox", { name: "Link" }),
      "https://order.test"
    )
    const away = vi.fn((event: MouseEvent) => event.preventDefault())
    const inbox = screen.getByRole("link", { name: "Inbox" })
    inbox.addEventListener("click", away)
    await user.click(inbox)
    expect(away).not.toHaveBeenCalled()
    expect(
      await screen.findByRole("alertdialog", { name: "Leave without saving?" })
    ).toBeInTheDocument()
  })
})
