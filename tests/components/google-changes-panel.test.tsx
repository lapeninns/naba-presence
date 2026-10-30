import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { GoogleChangesPanel } from "@/components/locations/suggestions/google-changes-panel"
import { ApiClientError } from "@/lib/api/client"
import * as watchApi from "@/lib/api/google-change-watch"
import * as businessInfoApi from "@/lib/api/location-business-information"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import type {
  GoogleChange,
  GoogleChangeRevert,
  GoogleChangesResponse,
} from "@/lib/contracts/google-change-watch"

const LOCATION = "33333333-3333-4333-8333-333333333333"
const GOOGLE_HASH = "a".repeat(64)
const DECIDE_REASON =
  "Only owners and admins who can publish this listing can put ours back or keep Google’s."

function change(overrides: Partial<GoogleChange> = {}): GoogleChange {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    field: "name",
    status: "open",
    resolution: null,
    ours: { field: "name", value: "The White Horse" },
    google: { field: "name", value: "White Horse Pub" },
    googleHash: GOOGLE_HASH,
    localEdits: false,
    regularDays: [],
    specialDates: [],
    detectedAt: "2026-10-28T09:00:00.000Z",
    lastSeenAt: "2026-10-29T09:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    revert: null,
    ...overrides,
  }
}

function hoursChange(overrides: Partial<GoogleChange> = {}): GoogleChange {
  return change({
    id: "22222222-2222-4222-8222-222222222222",
    field: "regularHours",
    ours: {
      field: "regularHours",
      value: [
        {
          dayOfWeek: 1,
          isClosed: false,
          periods: [{ opensAt: "12:00", closesAt: "22:00" }],
        },
      ],
    },
    google: {
      field: "regularHours",
      value: [{ dayOfWeek: 1, isClosed: true, periods: [] }],
    },
    regularDays: [1],
    ...overrides,
  })
}

function changeSet(overrides: Partial<GbpChangeSet> = {}): GbpChangeSet {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    locationName: "locations/123",
    payloadHash: "p".repeat(64),
    baselineHash: "q".repeat(64),
    payload: { title: "The White Horse" },
    baseline: { title: "White Horse Pub" },
    updateMask: ["title"],
    requestedBy: "Ada",
    approvedBy: null,
    requiresSecondApprover: false,
    canApprove: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function reverting(revert: GoogleChangeRevert): GoogleChange {
  return change({ status: "reverting", decidedBy: "Ada", revert })
}

function response(
  changes: GoogleChange[],
  overrides: Partial<GoogleChangesResponse> = {}
): GoogleChangesResponse {
  return {
    changes,
    canDecide: true,
    lastCheckedAt: "2026-10-29T09:00:00.000Z",
    ...overrides,
  }
}

function mockChanges(data: GoogleChangesResponse) {
  return vi.spyOn(watchApi, "fetchGoogleChanges").mockResolvedValue(data)
}

function mockDecide() {
  return vi.spyOn(watchApi, "decideGoogleChange").mockResolvedValue({
    change: change({ status: "reverting" }),
    outcome: "review_created",
  })
}

function renderPanel() {
  return renderWithProviders(<GoogleChangesPanel locationId={LOCATION} />)
}

/** The list row of the change whose diff table has this title. */
async function rowFor(title: string) {
  const table = await screen.findByRole("table", {
    name: `${title}: ours against Google’s`,
  })
  const row = table.closest("li")
  expect(row).not.toBeNull()
  return row as HTMLElement
}

describe("GoogleChangesPanel", () => {
  beforeEach(() => {
    vi.spyOn(watchApi, "fetchGoogleWatchSettings").mockResolvedValue({
      settings: {
        protectedFields: [
          "name",
          "description",
          "phone",
          "website",
          "primaryCategory",
          "regularHours",
          "specialHours",
        ],
        alertMode: "managers",
        recipientIds: [],
        updatedAt: null,
        updatedBy: null,
      },
      canManage: true,
      people: [],
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it("announces loading while the changes are fetched", () => {
    vi.spyOn(watchApi, "fetchGoogleChanges").mockReturnValue(
      new Promise(() => {})
    )
    renderPanel()

    expect(screen.getByText("Loading changes made on Google…")).toHaveAttribute(
      "role",
      "status"
    )
  })

  it("shows an error alert with a Try again that refetches", async () => {
    const fetch = vi
      .spyOn(watchApi, "fetchGoogleChanges")
      .mockRejectedValueOnce(new ApiClientError(500, "internal", "boom"))
      .mockResolvedValue(response([]))
    renderPanel()

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("We couldn’t load changes made on Google")

    // Try again sits outside the alert, so the alert reads what happened.
    expect(
      within(alert).queryByRole("button", { name: "Try again" })
    ).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole("heading", {
        name: /Protected fields Google changed/,
      })
    ).toBeInTheDocument()
  })

  it("says Google matches ours when there are no live changes and Google was checked", async () => {
    mockChanges(response([]))
    renderPanel()

    expect(
      await screen.findByRole("heading", {
        name: /Protected fields Google changed/,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Google matches ours for every protected field\./)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Not checked with Google yet/)).toBeNull()
  })

  it("says Google hasn't been checked yet when lastCheckedAt is null", async () => {
    mockChanges(response([], { lastCheckedAt: null }))
    renderPanel()

    expect(
      await screen.findByText(/Not checked with Google yet/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Google matches yours/)).toBeNull()
  })

  it("shows an open profile change with its status and an Ours / On Google diff", async () => {
    mockChanges(response([change({ localEdits: true })]))
    renderPanel()

    const row = await rowFor("Business name")
    // The row title (outside the diff table, which also names the field).
    expect(
      within(row)
        .getAllByText("Business name")
        .filter((element) => !element.closest("table"))
    ).toHaveLength(1)
    expect(within(row).getByText("Needs a decision")).toBeInTheDocument()
    expect(
      within(row).getByText("Ours includes unpublished edits")
    ).toBeInTheDocument()

    const table = within(row).getByRole("table")
    expect(
      within(table).getByRole("columnheader", { name: "Ours" })
    ).toBeInTheDocument()
    expect(
      within(table).getByRole("columnheader", { name: "Google’s" })
    ).toBeInTheDocument()
    const cells = within(table).getAllByRole("cell")
    expect(cells[0]).toHaveTextContent("The White Horse")
    expect(cells[1]).toHaveTextContent("White Horse Pub")

    expect(
      within(row).getByRole("button", { name: "Put ours back" })
    ).toBeInTheDocument()
    expect(
      within(row).getByRole("button", { name: "Keep Google’s" })
    ).toBeInTheDocument()
  })

  it("does not flag unpublished edits when localEdits is false", async () => {
    mockChanges(
      response([
        change({
          field: "phone",
          ours: { field: "phone", value: "01234 567890" },
          google: { field: "phone", value: "01234 000000" },
        }),
      ])
    )
    renderPanel()

    const row = await rowFor("Phone number")
    expect(within(row).getByText("Needs a decision")).toBeInTheDocument()
    expect(
      within(row).queryByText("Ours includes unpublished edits")
    ).toBeNull()
  })

  it("titles a regular-hours change with the day and shows one diff row per changed day", async () => {
    mockChanges(response([hoursChange()]))
    renderPanel()

    const row = await rowFor("Opening hours: Monday")
    expect(within(row).getByText("Opening hours: Monday")).toBeInTheDocument()
    const table = within(row).getByRole("table")
    const bodyRows = within(table).getAllByRole("row").slice(1)
    expect(bodyRows).toHaveLength(1)
    expect(
      within(bodyRows[0]!).getByRole("rowheader", { name: "Monday" })
    ).toBeInTheDocument()
    const cells = within(bodyRows[0]!).getAllByRole("cell")
    expect(cells[0]).toHaveTextContent("12:00–22:00")
    expect(cells[1]).toHaveTextContent("Closed")
  })

  it("titles a special-hours change with its date", async () => {
    mockChanges(
      response([
        change({
          id: "55555555-5555-4555-8555-555555555555",
          field: "specialHours",
          ours: {
            field: "specialHours",
            value: [
              {
                effectiveDate: "2026-12-25",
                isClosed: true,
                opensAt: null,
                closesAt: null,
              },
            ],
          },
          google: { field: "specialHours", value: [] },
          specialDates: ["2026-12-25"],
        }),
      ])
    )
    renderPanel()

    const table = await screen.findByRole("table", {
      name: /^Special hours: .*25 Dec 2026: ours against Google’s$/,
    })
    const bodyRows = within(table).getAllByRole("row").slice(1)
    expect(bodyRows).toHaveLength(1)
    expect(bodyRows[0]).toHaveTextContent(/25 Dec 2026/)
    const cells = within(bodyRows[0]!).getAllByRole("cell")
    expect(cells[0]).toHaveTextContent("Closed")
    expect(cells[1]).toHaveTextContent("Usual hours")
  })

  it("disables every decision for a viewer who can't decide, with the reason", async () => {
    mockChanges(response([change()], { canDecide: false }))
    const decide = mockDecide()
    const check = vi.spyOn(watchApi, "checkGoogleChanges")
    renderPanel()

    const row = await rowFor("Business name")
    for (const name of ["Put ours back", "Keep Google’s"]) {
      const button = within(row).getByRole("button", { name })
      expect(button).toHaveAttribute("aria-disabled", "true")
      expect(button).toHaveAccessibleDescription(DECIDE_REASON)
      await userEvent.click(button)
    }
    // The reason is visible too, not only on the disabled buttons.
    expect(
      screen.getByText(`${DECIDE_REASON} You can see what changed.`)
    ).toBeInTheDocument()

    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(decide).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
  })

  it("puts a profile field back at once, with the Google value it saw, and says it is ready to review", async () => {
    mockChanges(response([change()]))
    const decide = mockDecide()
    renderPanel()

    const row = await rowFor("Business name")
    await userEvent.click(
      within(row).getByRole("button", { name: "Put ours back" })
    )

    await waitFor(() => expect(decide).toHaveBeenCalled())
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(decide.mock.calls[0]?.slice(0, 3)).toEqual([
      LOCATION,
      change().id,
      { action: "put_ours_back", expectedGoogleHash: GOOGLE_HASH },
    ])
    expect(await screen.findByText(/ready to review/i)).toBeInTheDocument()
  })

  it("asks before putting hours back, and only then calls the API", async () => {
    mockChanges(response([hoursChange()]))
    const decide = mockDecide()
    renderPanel()

    const row = await rowFor("Opening hours: Monday")
    await userEvent.click(
      within(row).getByRole("button", { name: "Put ours back" })
    )

    const dialog = await screen.findByRole("alertdialog", {
      name: "Put our hours back on Google?",
    })
    expect(decide).not.toHaveBeenCalled()

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Put ours back" })
    )
    await waitFor(() => expect(decide).toHaveBeenCalled())
    expect(decide.mock.calls[0]?.slice(0, 3)).toEqual([
      LOCATION,
      hoursChange().id,
      { action: "put_ours_back", expectedGoogleHash: GOOGLE_HASH },
    ])
  })

  it("cancelling the hours confirmation calls nothing", async () => {
    mockChanges(response([hoursChange()]))
    const decide = mockDecide()
    renderPanel()

    const row = await rowFor("Opening hours: Monday")
    await userEvent.click(
      within(row).getByRole("button", { name: "Put ours back" })
    )
    const dialog = await screen.findByRole("alertdialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" })
    )

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(decide).not.toHaveBeenCalled()
  })

  it("asks before keeping Google’s, then accepts it", async () => {
    const phone = change({
      field: "phone",
      ours: { field: "phone", value: "01234 567890" },
      google: { field: "phone", value: "01234 000000" },
    })
    mockChanges(response([phone]))
    const decide = vi.spyOn(watchApi, "decideGoogleChange").mockResolvedValue({
      change: { ...phone, status: "accepted" },
      outcome: "accepted",
    })
    renderPanel()

    const row = await rowFor("Phone number")
    await userEvent.click(
      within(row).getByRole("button", { name: "Keep Google’s" })
    )
    const dialog = await screen.findByRole("alertdialog", {
      name: /^Keep Google’s .*\?$/,
    })
    expect(decide).not.toHaveBeenCalled()

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Keep Google’s" })
    )
    await waitFor(() => expect(decide).toHaveBeenCalled())
    expect(decide.mock.calls[0]?.slice(0, 3)).toEqual([
      LOCATION,
      phone.id,
      { action: "accept_google", expectedGoogleHash: GOOGLE_HASH },
    ])
  })

  it("requires an acknowledgement before keeping Google’s over unpublished edits", async () => {
    mockChanges(response([change({ localEdits: true })]))
    const decide = vi.spyOn(watchApi, "decideGoogleChange").mockResolvedValue({
      change: change({ status: "accepted" }),
      outcome: "accepted",
    })
    renderPanel()

    const row = await rowFor("Business name")
    await userEvent.click(
      within(row).getByRole("button", { name: "Keep Google’s" })
    )
    const dialog = await screen.findByRole("alertdialog", {
      name: /^Keep Google’s .*\?$/,
    })
    const confirm = within(dialog).getByRole("button", {
      name: "Keep Google’s",
    })
    expect(
      confirm.hasAttribute("disabled") ||
        confirm.getAttribute("aria-disabled") === "true"
    ).toBe(true)
    await userEvent.click(confirm)
    expect(decide).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole("checkbox"))
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Keep Google’s" })
    )
    await waitFor(() => expect(decide).toHaveBeenCalled())
    expect(decide.mock.calls[0]?.[2]).toEqual({
      action: "accept_google",
      expectedGoogleHash: GOOGLE_HASH,
    })
  })

  it("shows a failed decision on the row as Didn’t go through with the error message", async () => {
    mockChanges(response([change()]))
    vi.spyOn(watchApi, "decideGoogleChange").mockRejectedValue(
      new ApiClientError(403, "forbidden", "Not allowed")
    )
    renderPanel()

    const row = await rowFor("Business name")
    await userEvent.click(
      within(row).getByRole("button", { name: "Put ours back" })
    )

    const alert = await within(row).findByRole("alert")
    expect(alert).toHaveTextContent("Didn’t go through")
    expect(alert).toHaveTextContent("You do not have permission to do that.")
  })

  it("approves a put-back waiting for approval with the change set's payload hash", async () => {
    const set = changeSet()
    mockChanges(
      response([
        reverting({ kind: "change_set", changeSet: set, dispatched: false }),
      ])
    )
    const approve = vi
      .spyOn(businessInfoApi, "approveBusinessInformation")
      .mockResolvedValue({ ...set, approvedBy: "Ada" })
    const decide = mockDecide()
    renderPanel()

    const row = await rowFor("Business name")
    expect(within(row).getByText("Waiting for approval")).toBeInTheDocument()
    expect(
      within(row).queryByRole("button", { name: "Put ours back" })
    ).toBeNull()
    expect(
      within(row).queryByRole("button", { name: "Publish to Google" })
    ).toBeNull()

    await userEvent.click(within(row).getByRole("button", { name: "Approve" }))
    await waitFor(() => expect(approve).toHaveBeenCalled())
    expect(approve.mock.calls[0]).toEqual([LOCATION, set.id, set.payloadHash])
    expect(decide).not.toHaveBeenCalled()
  })

  it("disables Approve for the person who can't approve their own put-back", async () => {
    const set = changeSet({ canApprove: false, requiresSecondApprover: true })
    mockChanges(
      response([
        reverting({ kind: "change_set", changeSet: set, dispatched: false }),
      ])
    )
    const approve = vi.spyOn(businessInfoApi, "approveBusinessInformation")
    renderPanel()

    const row = await rowFor("Business name")
    const button = within(row).getByRole("button", { name: "Approve" })
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button).toHaveAccessibleDescription(
      "A different owner or admin must approve this."
    )
    await userEvent.click(button)
    expect(approve).not.toHaveBeenCalled()
  })

  it("publishes an approved put-back bound to the change set's baseline", async () => {
    const set = changeSet({ approvedBy: "Grace" })
    mockChanges(
      response([
        reverting({ kind: "change_set", changeSet: set, dispatched: false }),
      ])
    )
    const publish = vi
      .spyOn(businessInfoApi, "publishBusinessInformation")
      .mockResolvedValue({
        id: "m-1",
        status: "succeeded",
        idempotent: false,
        confirmationState: "confirmed",
      } as never)
    renderPanel()

    const row = await rowFor("Business name")
    expect(within(row).getByText("Ready to publish")).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: "Approve" })).toBeNull()

    await userEvent.click(
      within(row).getByRole("button", { name: "Publish to Google" })
    )
    await waitFor(() => expect(publish).toHaveBeenCalled())
    expect(publish.mock.calls[0]?.slice(0, 2)).toEqual([
      LOCATION,
      {
        operation: "update_location",
        confirmation: "publish_business_information_to_google",
        changeSetId: set.id,
        payload: set.payload,
        updateMask: set.updateMask,
        expectedGoogleHash: set.baselineHash,
      },
    ])
    expect(await screen.findByText("Sent to Google")).toBeInTheDocument()
  })

  it("does not call an unconfirmed publish sent", async () => {
    const set = changeSet({ approvedBy: "Grace" })
    mockChanges(
      response([
        reverting({ kind: "change_set", changeSet: set, dispatched: false }),
      ])
    )
    vi.spyOn(businessInfoApi, "publishBusinessInformation").mockResolvedValue({
      id: "m-1",
      status: "ambiguous",
      idempotent: false,
    } as never)
    renderPanel()

    const row = await rowFor("Business name")
    await userEvent.click(
      within(row).getByRole("button", { name: "Publish to Google" })
    )
    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Google hasn’t confirmed it yet"
    )
    expect(screen.queryByText("Sent to Google")).toBeNull()
  })

  it("shows a dispatched put-back as sent and offers nothing to press", async () => {
    mockChanges(
      response([
        reverting({
          kind: "change_set",
          changeSet: changeSet({ approvedBy: "Grace" }),
          dispatched: true,
        }),
      ])
    )
    renderPanel()

    const row = await rowFor("Business name")
    expect(
      within(row).getByText("Sent to Google, waiting for Google to confirm")
    ).toBeInTheDocument()
    expect(within(row).queryByRole("button")).toBeNull()
  })

  it("points an hours put-back awaiting a second approval to the hours editor", async () => {
    mockChanges(
      response([
        hoursChange({
          status: "reverting",
          revert: {
            kind: "change_request",
            operationId: "op-1",
            outcome: "awaiting_approval",
          },
        }),
      ])
    )
    renderPanel()

    const row = await rowFor("Opening hours: Monday")
    expect(
      within(row).getByText("Waiting for a second approval")
    ).toBeInTheDocument()
    expect(
      within(row).getByRole("link", { name: "Open the hours editor" })
    ).toHaveAttribute("href", `/listings/${LOCATION}/hours`)
    expect(within(row).queryByRole("button")).toBeNull()
  })

  it("summarises what is protected and opens the settings on request", async () => {
    mockChanges(response([]))
    renderPanel()

    expect(
      await screen.findByText(
        "7 fields protected · alerts go to owners and admins"
      )
    ).toBeInTheDocument()
    const toggle = screen.getByRole("button", {
      name: "Choose protected fields",
    })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    await userEvent.click(toggle)
    expect(
      screen.getByRole("button", { name: "Hide protected fields" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(
      await screen.findByRole("heading", { name: "What’s protected on Google" })
    ).toBeInTheDocument()
  })

  it("expires a put-back review that was never published", async () => {
    mockChanges(
      response([
        reverting({
          kind: "change_set",
          changeSet: changeSet({ expiresAt: "2020-01-01T00:00:00.000Z" }),
          dispatched: false,
        }),
      ])
    )
    renderPanel()

    const row = await rowFor("Business name")
    expect(within(row).getByText("Review expired")).toBeInTheDocument()
    expect(within(row).queryByRole("button")).toBeNull()
  })

  it("lists earlier changes in a collapsed disclosure with their outcome", async () => {
    mockChanges(
      response([
        change({
          id: "66666666-6666-4666-8666-666666666666",
          status: "accepted",
          decidedBy: "Ada",
        }),
        change({
          id: "77777777-7777-4777-8777-777777777777",
          field: "website",
          ours: { field: "website", value: "https://a.example" },
          google: { field: "website", value: "https://b.example" },
          status: "resolved",
          resolution: "published",
        }),
        change({
          id: "88888888-8888-4888-8888-888888888888",
          field: "phone",
          ours: { field: "phone", value: "01234 567890" },
          google: { field: "phone", value: "01234 000000" },
          status: "superseded",
        }),
      ])
    )
    renderPanel()

    const summary = await screen.findByText("Earlier changes on Google (3)")
    const details = summary.closest("details")
    expect(details).not.toBeNull()
    expect(details!.open).toBe(false)
    expect(details).toHaveTextContent("Kept Google’s")
    expect(details).toHaveTextContent("Ours was put back on Google")
    expect(details).toHaveTextContent("Replaced by a newer change")
    // History rows are not live: no decision buttons and no "waiting" count.
    expect(screen.queryByRole("button", { name: "Put ours back" })).toBeNull()
    expect(
      screen.getByText(/Google matches ours for every protected field\./)
    ).toBeInTheDocument()
  })
})
