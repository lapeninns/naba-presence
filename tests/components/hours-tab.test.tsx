import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HoursTab } from "@/components/locations/hours-tab"
import { SERVICE_OPTIONS_WARNING } from "@/lib/editors/hours-notes"
import * as hoursApi from "@/lib/api/location-hours"
import { Toaster } from "@/components/ui/toast"
import { emptyHours } from "@/lib/locations/forms/hours"
import type { HoursState } from "@/lib/api/location-hours"

const useHoursMock = vi.fn()
const useCapsMock = vi.fn()
const refreshHours = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
  isError: false,
}))
vi.mock("@/lib/queries/use-location-hours", () => ({
  useHours: () => useHoursMock(),
  useRefreshHours: () => refreshHours,
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

type User = ReturnType<typeof userEvent.setup>

/** A weekday's fields live in its sheet: open it from its row. */
async function openDay(user: User, name = "Monday") {
  await user.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }))
  return screen.findByRole("dialog", { name: new RegExp(`^${name} hours$`) })
}

async function closeDay(user: User, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole("button", { name: "Done" }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
}

/** Type a new Monday opening time through the day's sheet, then close it. */
async function setMondayOpens(user: User, time: string) {
  const dialog = await openDay(user)
  const opens = within(dialog).getByLabelText("Monday period 1 opens")
  await user.clear(opens)
  await user.type(opens, time)
  await closeDay(user, dialog)
}

/** Read Monday's opening time back from its sheet. */
async function expectMondayOpens(user: User, time: string) {
  // A review or publish sheet left open hides the day rows: close it first.
  if (!screen.queryByRole("button", { name: /^Monday/ })) {
    await user.keyboard("{Escape}")
    await screen.findByRole("button", { name: /^Monday/ })
  }
  const dialog = await openDay(user)
  expect(within(dialog).getByLabelText("Monday period 1 opens")).toHaveValue(
    time
  )
  await closeDay(user, dialog)
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
  it("folds the hours notes into one notice instead of stacked banners", () => {
    useHoursMock.mockReturnValue({
      data: makeHours({
        reconciliationRequired: true,
        warnings: [
          "Some saved periods have no confirmed closing day or date. Compare them with Google and explicitly save their end boundaries before publishing.",
          SERVICE_OPTIONS_WARNING,
        ],
      }),
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    const { container } = renderTab()
    // Alert announces a destructive note as role="alert" and every other tone
    // as role="status" (components/ui/alert.tsx), so find the notices by the
    // Alert slot and require each one to be a live region of either kind.
    const notices = Array.from(
      container.querySelectorAll<HTMLElement>('[data-slot="alert"]')
    )
    // The weekly notice, and the service-options note in the service group.
    expect(notices).toHaveLength(2)
    const notice = notices[0]!
    expect(["alert", "status"]).toContain(notice.getAttribute("role"))
    // Google is empty and the boundaries need confirming: two notes, one
    // panel. The server's boundary warning repeats the "Confirm saved closing
    // days" note, so it is not listed. The service-options note belongs to the
    // service hours, not to the weekly schedule above them.
    expect(notice).toHaveTextContent("2 things to know about these hours")
    expect(within(notice).getAllByRole("listitem")).toHaveLength(2)
    expect(notice).not.toHaveTextContent("no confirmed closing day")
    expect(notice).not.toHaveTextContent("service options")
    expect(notice).toHaveTextContent("No hours on Google")
    expect(
      screen.getByText(SERVICE_OPTIONS_WARNING).closest('[data-slot="alert"]')
    ).not.toBe(notice)
    expect(
      within(notice).getByRole("button", {
        name: "Match Google closing boundaries",
      })
    ).toBeEnabled()
  })

  it("names the time zone in words when it is not the viewer's own", () => {
    useHoursMock.mockReturnValue({
      data: makeHours({
        location: {
          id: "loc-1",
          name: "Riverside",
          googleLocationName: "locations/1",
          timezone: "Pacific/Auckland",
        },
      }),
      isPending: false,
    })
    renderTab()
    expect(screen.getByText(/Times are in/)).toHaveTextContent(
      "Times are in New Zealand time."
    )
    expect(screen.queryByText(/Pacific\/Auckland/)).not.toBeInTheDocument()
  })

  it("says nothing about the zone when it is the viewer's own", () => {
    useHoursMock.mockReturnValue({
      data: makeHours({
        location: {
          id: "loc-1",
          name: "Riverside",
          googleLocationName: "locations/1",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
      isPending: false,
    })
    renderTab()
    expect(screen.queryByText(/Times are in/)).not.toBeInTheDocument()
  })

  it("names every Copy to… control with its visible text", async () => {
    const user = userEvent.setup()
    useHoursMock.mockReturnValue({ data: makeHours(), isPending: false })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    const dialog = await openDay(user)
    const copy = within(dialog).getAllByRole("button", { name: /^Copy to…/ })
    expect(copy.length).toBeGreaterThan(0)
    for (const button of copy)
      expect(button.getAttribute("aria-label")).toContain(
        button.textContent?.trim() ?? ""
      )
  })

  it("says when Google was last checked and checks it again on request", async () => {
    useHoursMock.mockReturnValue({
      data: makeHours({
        observedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
        source: "stored",
      }),
      isPending: false,
    })
    renderTab()
    expect(screen.getByText(/Checked with Google/)).toHaveTextContent(
      "Checked with Google 3 minutes ago."
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Check Google now" })
    )
    expect(refreshHours.mutate).toHaveBeenCalledOnce()
  })

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
    await setMondayOpens(user, "08:00")

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

  it("keeps saving here available while publishing is paused, and says why", async () => {
    const user = userEvent.setup()
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
    // Saving here is not publishing: with an edit to keep it stays
    // available for an owner (there is no bar, or no Save here, until then).
    await setMondayOpens(user, "08:00")
    expect(screen.getByRole("button", { name: "Save here" })).toBeEnabled()
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeDisabled()
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
    const edit = await openDay(user)
    const closes = within(edit).getByLabelText("Monday period 1 closes")
    await user.clear(closes)
    await user.type(closes, "09:00")
    await closeDay(user, edit)
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
    // The row says what is wrong without opening the day.
    expect(
      screen.getByRole("button", { name: /^Monday/ })
    ).toHaveAccessibleDescription(/Opening and closing times are the same/)
    // The link opens the day's sheet on the field that needs fixing.
    await user.click(
      within(summary).getByRole("link", {
        name: /Monday: Opening and closing times are the same/,
      })
    )
    const fix = await screen.findByRole("dialog")
    expect(within(fix).getByLabelText("Monday period 1 opens")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
  })

  it("opens a special day's sheet before the summary moves focus to its field", async () => {
    const user = userEvent.setup()
    const hours = makeHours()
    hours.canonical.special = [
      {
        effectiveDate: "2099-12-24",
        isClosed: false,
        opensAt: "10:00",
        closesAt: "10:00",
      },
    ]
    useHoursMock.mockReturnValue({
      data: hours,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    })
    useCapsMock.mockReturnValue({
      data: { canEditCanonical: true, canPublish: true },
    })
    renderTab()
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    const summary = await screen.findByRole("alert", {
      name: /problem to fix/i,
    })
    const link = within(summary).getByRole("link", {
      name: /Special date 1: Opening and closing times are the same/,
    })
    expect(link).toHaveAttribute("href", "#special-0-opens")
    // The field is in the day's sheet, which is closed until the link opens it.
    expect(document.getElementById("special-0-opens")).toBeNull()
    await user.click(link)
    const sheet = await screen.findByRole("dialog", { name: /24 Dec 2099/ })
    const opens = within(sheet).getByLabelText("Special date 1 opens")
    await waitFor(() => expect(opens).toHaveFocus())
    expect(opens).toHaveAttribute("aria-invalid", "true")
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
    await setMondayOpens(user, "08:00")
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
    await expectMondayOpens(user, "08:00")
    useHoursMock.mockReturnValue({
      data: makeHours({
        canonicalResource: { revision: "4", updatedAt: "later" },
      }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    })
    view.rerenderTab()
    await expectMondayOpens(user, "08:00")
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
    await setMondayOpens(user, "08:00")
    await user.click(screen.getByRole("button", { name: "Save here" }))
    await screen.findAllByText(
      "Google or our service is temporarily unavailable. Try again shortly."
    )
    expect(
      JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).hours.moreHours
    ).toEqual(state.canonical.moreHours)
    await expectMondayOpens(user, "08:00")
    const unknownDay = await openDay(user, "UNKNOWN Sunday")
    expect(
      within(unknownDay).getByRole("combobox", {
        name: "UNKNOWN Sunday period 1 closing day",
      })
    ).toHaveTextContent("Next day (Monday)")
    await closeDay(user, unknownDay)
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
    await setMondayOpens(user, "08:00")
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
    // Nothing left to save: the secondaries leave the bar instead of greying.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save here" })).toBeNull()
    )
    expect(
      screen.queryByText(/Someone else saved these hours/)
    ).not.toBeInTheDocument()
    await expectMondayOpens(user, "08:00")
  })
})

describe("HoursTab selective publish", () => {
  function selectiveState(overrides: Partial<HoursState> = {}): HoursState {
    const google = emptyHours()
    google.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "10:00", closesAt: "16:00", closeDayOfWeek: 1 }],
    }
    const canonical = structuredClone(google)
    canonical.regular[1].periods[0].opensAt = "09:00"
    canonical.special = [
      {
        effectiveDate: "2026-12-25",
        endDate: "2026-12-25",
        isClosed: true,
        opensAt: null,
        closesAt: null,
      },
    ]
    return makeHours({
      canonical,
      google,
      updateMask: ["regularHours", "specialHours"],
      googlePartHashes: { "regular:1": "g".repeat(64) },
      ...overrides,
    })
  }
  function show(state: HoursState) {
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

  it("publishes only the ticked parts, pinned to their Google part hashes", async () => {
    const user = userEvent.setup()
    const publish = vi
      .spyOn(hoursApi, "publishHours")
      .mockResolvedValue({ status: "published" })
    show(selectiveState())
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    const sheet = await screen.findByRole("dialog")
    expect(
      within(sheet).getByText("Choose what to publish")
    ).toBeInTheDocument()
    await user.click(within(sheet).getByRole("checkbox", { name: "Monday" }))
    expect(within(sheet).getByText(/1 field will change/)).toBeInTheDocument()
    await user.click(
      within(sheet).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        "loc-1",
        {
          expectedCanonicalRevision: "2",
          expectedCanonicalHash: "ch",
          expectedGoogleHash: "gh",
          approvedUpdateMask: ["specialHours"],
          confirmOverwriteGoogleChanges: false,
          selection: {
            specialDates: ["2026-12-25"],
            expectedGoogleParts: { "special:2026-12-25": null },
          },
        },
        { intentId: expect.any(String) }
      )
    )
  })

  it("asks to confirm an overwrite only while a Google-changed part is ticked", async () => {
    const user = userEvent.setup()
    const publish = vi
      .spyOn(hoursApi, "publishHours")
      .mockResolvedValue({ status: "published" })
    show(
      selectiveState({
        status: "conflict",
        partStatus: {
          "regular:1": "google_dirty",
          "special:2026-12-25": "core_dirty",
        },
      })
    )
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    const sheet = await screen.findByRole("dialog")
    const button = within(sheet).getByRole("button", {
      name: "Publish to Google",
    })
    expect(within(sheet).getByText(/want to replace it/)).toBeInTheDocument()
    expect(button).toBeDisabled()
    await user.click(within(sheet).getByRole("checkbox", { name: "Monday" }))
    expect(within(sheet).queryByText(/want to replace it/)).toBeNull()
    await user.click(button)
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith(
        "loc-1",
        expect.objectContaining({
          confirmOverwriteGoogleChanges: false,
          approvedUpdateMask: ["specialHours"],
        }),
        { intentId: expect.any(String) }
      )
    )
  })
})
