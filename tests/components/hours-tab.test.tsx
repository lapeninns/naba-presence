import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HoursTab } from "@/components/locations/hours-tab"
import * as hoursApi from "@/lib/api/location-hours"
import { Toaster } from "@/components/ui/toast"
import { emptyHours } from "@/lib/locations/forms/hours"
import type { HoursState } from "@/lib/api/location-hours"

const useHoursMock = vi.fn()
const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-hours", () => ({
  useHours: () => useHoursMock(),
}))
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => useCapsMock(),
}))

function makeHours(overrides: Partial<HoursState> = {}): HoursState {
  const canonical = emptyHours()
  canonical.regular[1] = {
    dayOfWeek: 1,
    isClosed: false,
    periods: [{ opensAt: "09:00", closesAt: "17:00" }],
  }
  return {
    location: {
      id: "loc-1",
      name: "Riverside",
      googleLocationName: "locations/1",
      timezone: "Europe/London",
    },
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const tree = () => (
    <QueryClientProvider client={client}>
      <Toaster>
        <HoursTab locationId="loc-1" />
      </Toaster>
    </QueryClientProvider>
  )
  const view = render(tree())
  return { ...view, rerenderTab: () => view.rerender(tree()) }
}

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("HoursTab", () => {
  it("renders each weekday and one primary action for an owner", () => {
    useHoursMock.mockReturnValue({
      data: makeHours(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    expect(screen.getByText("Monday")).toBeInTheDocument()
    expect(screen.getByText("Sunday")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeInTheDocument()
    // The two-button "Save changes / Publish to Google" pair is gone: nothing
    // reaches Google except through the review sheet.
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
  })

  it("names what would change on Google before anything is published", async () => {
    const user = userEvent.setup()
    useHoursMock.mockReturnValue({
      data: makeHours(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
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
    useHoursMock.mockReturnValue({
      data: makeHours({ writesEnabled: false }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: false, canPublish: false },
    })
    renderTab()
    // The footer becomes the view-only bar: it explains, and offers no
    // actions at all rather than disabled ones.
    expect(screen.getByText(/View-only access\./)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Save here" })).toBeNull()
    expect(
      screen.getAllByText("Only owners and admins can edit this location.")
        .length
    ).toBeGreaterThan(0)
  })

  it("keeps saving here available while publishing is paused, and says why", () => {
    useHoursMock.mockReturnValue({
      data: makeHours(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: {
        canEditCanonical: true,
        canPublish: true,
        resources: {
          hours: { state: "readOnly", reasonCode: "publishing_paused" },
        },
      },
    })
    renderTab()
    expect(
      screen.getByText("Publishing to Google is switched off in NabaPresence")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Whoever runs NabaPresence for your team can switch it back on/
      )
    ).toBeInTheDocument()
    // The reason code is kept for support, folded away rather than in the sentence.
    expect(screen.getByText("Details for support")).toBeInTheDocument()
    expect(
      screen.getByText("publishing_paused").closest("details")
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeDisabled()
    // Saving here is not publishing: it stays available for an owner.
    expect(
      screen.getByRole("button", { name: "Save here" })
    ).toBeInTheDocument()
  })

  it("points the validation summary at the field that needs fixing", async () => {
    const user = userEvent.setup()
    useHoursMock.mockReturnValue({
      data: makeHours(),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    const closes = screen.getByLabelText("Monday period 1 closes")
    await user.clear(closes)
    await user.type(closes, "09:00")
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    const summary = await screen.findByRole("alert", {
      name: /problem to fix/i,
    })
    expect(summary).toHaveFocus()
    expect(
      within(summary).getByRole("link", {
        name: /Monday: Opening and closing times are the same/,
      })
    ).toHaveAttribute("href", "#hours-1-0-opens")
    expect(screen.getByLabelText("Monday period 1 opens")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    // No sheet: nothing is offered for publishing while the draft is invalid.
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("HoursTab reviewed snapshots", () => {
  function setup(state: HoursState) {
    useHoursMock.mockReturnValue({
      data: state,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    return renderTab()
  }

  it("blocks publication when Google changes between a dirty review and the saved readback", async () => {
    const user = userEvent.setup()
    const state = makeHours()
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ saved: true, revision: "3" }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            hours: makeHours({
              canonicalResource: {
                revision: "3",
                updatedAt: state.canonicalResource.updatedAt,
              },
              googleHash: "changed-after-review",
            }),
          }),
          { status: 200 }
        )
      )
    const view = setup(state)
    await user.clear(screen.getByLabelText("Monday period 1 opens"))
    await user.type(screen.getByLabelText("Monday period 1 opens"), "08:00")
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Publish to Google",
      })
    )
    await screen.findAllByText(
      "This changed since you loaded it. Refresh and try again."
    )
    expect(fetchSpy.mock.calls.map((call) => call[1]?.method ?? "GET")).toEqual(
      ["PUT", "GET"]
    )
    expect(screen.getByLabelText("Monday period 1 opens")).toHaveValue("08:00")
    useHoursMock.mockReturnValue({
      data: makeHours({
        canonicalResource: { revision: "4", updatedAt: "later" },
      }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    view.rerenderTab()
    expect(screen.getByLabelText("Monday period 1 opens")).toHaveValue("08:00")
    expect(
      screen.getByText(/Someone else saved these hours/)
    ).toBeInTheDocument()
    fetchSpy.mockRestore()
  })

  it("keeps the old reviewed hashes when a background query changes during an open review", async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "hours_snapshot_stale",
          message: "Reviewed schedule is stale.",
        }),
        { status: 409 }
      )
    )
    const view = setup(makeHours())
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    useHoursMock.mockReturnValue({
      data: makeHours({
        googleHash: "newer-google-hash",
        canonicalResource: {
          revision: "3",
          updatedAt: "2026-08-02T00:00:00.000Z",
        },
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    view.rerenderTab()
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Publish to Google",
      })
    )
    await screen.findAllByText(
      "The opening hours changed since you loaded them. Refresh and try again."
    )
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))
    expect(body).toMatchObject({
      expectedCanonicalRevision: "2",
      expectedCanonicalHash: "ch",
      expectedGoogleHash: "gh",
    })
    fetchSpy.mockRestore()
  })

  it("preserves the full service payload when a save fails", async () => {
    const user = userEvent.setup()
    const state = makeHours()
    state.canonical.moreHours = [
      {
        hoursTypeId: "UNKNOWN",
        periods: [
          {
            dayOfWeek: 0,
            closeDayOfWeek: 1,
            opensAt: "18:00",
            closesAt: "02:00",
          },
        ],
      },
    ]
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "save_failed",
          message: "Synthetic save failure.",
        }),
        { status: 503 }
      )
    )
    setup(state)
    await user.clear(screen.getByLabelText("Monday period 1 opens"))
    await user.type(screen.getByLabelText("Monday period 1 opens"), "08:00")
    await user.click(screen.getByRole("button", { name: "Save here" }))
    await screen.findAllByText(
      "Google or our service is temporarily unavailable. Try again shortly."
    )
    expect(
      JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).hours.moreHours
    ).toEqual(state.canonical.moreHours)
    expect(screen.getByLabelText("Monday period 1 opens")).toHaveValue("08:00")
    expect(
      screen.getByLabelText("UNKNOWN Sunday period 1 closing day")
    ).toHaveValue("1")
    fetchSpy.mockRestore()
  })
  it("cleans a dirty draft after its verified save and successful publish", async () => {
    const user = userEvent.setup()
    let fresh = makeHours()
    vi.spyOn(hoursApi, "saveHours").mockImplementation(async (_id, input) => {
      fresh = makeHours({
        canonical: input.hours,
        canonicalResource: { revision: "3", updatedAt: "later" },
      })
      return { saved: true, revision: "3" }
    })
    vi.spyOn(hoursApi, "fetchHours").mockImplementation(async () => fresh)
    const publish = vi
      .spyOn(hoursApi, "publishHours")
      .mockResolvedValue({ status: "published" })
    const view = setup(makeHours())
    await user.clear(screen.getByLabelText("Monday period 1 opens"))
    await user.type(screen.getByLabelText("Monday period 1 opens"), "08:00")
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Publish to Google",
      })
    )
    await waitFor(() => expect(publish).toHaveBeenCalled())
    useHoursMock.mockReturnValue({
      data: fresh,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    view.rerenderTab()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save here" })).toBeDisabled()
    )
    expect(
      screen.queryByText(/Someone else saved these hours/)
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText("Monday period 1 opens")).toHaveValue("08:00")
  })
})
