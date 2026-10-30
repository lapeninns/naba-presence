import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { SuggestionsTab } from "@/components/locations/suggestions/suggestions-page"
import { ApiClientError } from "@/lib/api/client"
import * as importReviewApi from "@/lib/api/location-import-review"
import type {
  ImportProposal,
  ImportReviewList,
} from "@/lib/api/location-import-review"

const LOCATION = "33333333-3333-4333-8333-333333333333"
const ROLE_REASON = "Only owners and admins can edit this location."
const BILLING_REASON =
  "This workspace's subscription is read-only, so changes are unavailable."

const useCapsMock = vi.fn()
vi.mock("@/lib/queries/use-location-capabilities", () => ({
  useLocationCapabilities: () => useCapsMock(),
}))
vi.mock("@/lib/queries/use-location-profile", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/queries/use-location-profile")
  >()),
  useProfile: () => ({
    data: { canonicalResource: { revision: "3" } },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

// The Google change watch panel and its settings have their own tests
// (tests/components/google-changes-panel.test.tsx); here they are quiet.
const watchChanges = vi.hoisted(() => ({ live: [] as unknown[] }))
vi.mock("@/lib/queries/use-google-change-watch", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/queries/use-google-change-watch")
  >()),
  useGoogleChanges: () => ({
    data: {
      changes: watchChanges.live,
      canDecide: true,
      lastCheckedAt: null,
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGoogleWatchSettings: () => ({
    data: {
      settings: {
        protectedFields: ["name"],
        alertMode: "managers",
        recipientIds: [],
        updatedAt: null,
        updatedBy: null,
      },
      canManage: false,
      people: [],
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

function caps(overrides: Record<string, unknown> = {}) {
  return {
    data: { canEditCanonical: true, canPublish: true, ...overrides },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }
}

function proposal(overrides: Partial<ImportProposal> = {}): ImportProposal {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    resourceType: "profile",
    identityKey: "phone",
    kind: "field_changed",
    fieldKey: "phone",
    googlePath: null,
    sectionLabel: null,
    itemLabel: null,
    matchStatus: null,
    matchConfidence: null,
    canonicalValue: "01234 567890",
    googleValue: "01234 000000",
    suggestedPatch: null,
    warnings: [],
    status: "pending",
    decision: null,
    failureCode: null,
    pinnedCanonicalRevision: "3",
    raisedVia: "sweep",
    observedAt: new Date().toISOString(),
    decidedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function list(proposals: ImportProposal[]): ImportReviewList {
  return {
    proposals,
    counts: { pending: proposals.length, profile: 0, foodMenus: 0 },
    importReviewEnabled: true,
  }
}

/** Serve each surface's list from the fixture; menu empty unless given. */
function serve(profile: ImportProposal[], menu: ImportProposal[] = []) {
  return vi
    .spyOn(importReviewApi, "fetchImportReview")
    .mockImplementation(async (_id, resourceType) =>
      list(resourceType === "food_menus" ? menu : profile)
    )
}

function outcome(raised: number) {
  return { raised, superseded: 0, skipped: null }
}

describe("SuggestionsTab", () => {
  afterEach(() => {
    watchChanges.live = []
  })

  it("leaves a protected field Google changed to the panel above, once", async () => {
    watchChanges.live = [
      {
        id: "99999999-9999-4999-8999-999999999999",
        field: "phone",
        status: "open",
        resolution: null,
        ours: { field: "phone", value: "01234 567890" },
        google: { field: "phone", value: "01234 000000" },
        googleHash: "a".repeat(64),
        localEdits: false,
        regularDays: [],
        specialDates: [],
        detectedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        decidedAt: null,
        decidedBy: null,
        revert: null,
      },
    ]
    serve([proposal()])
    renderWithProviders(<SuggestionsTab locationId={LOCATION} />)

    expect(
      await screen.findByText(
        /1 suggestion for protected fields is decided above/
      )
    ).toBeInTheDocument()
    // Decided in the panel ("Put ours back" / "Accept Google’s"), not
    // again as a suggestion (Accept / Ignore).
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Put ours back" })
    ).toBeInTheDocument()
  })

  beforeEach(() => useCapsMock.mockReturnValue(caps()))
  afterEach(() => vi.restoreAllMocks())

  it("tells a screen reader the list is loading", async () => {
    vi.spyOn(importReviewApi, "fetchImportReview").mockReturnValue(
      new Promise(() => {})
    )
    renderWithProviders(<SuggestionsTab locationId={LOCATION} />)

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Loading suggested updates…"
    )
  })

  it("announces a load error, with Try again outside the alert", async () => {
    vi.spyOn(importReviewApi, "fetchImportReview").mockRejectedValue(
      new ApiClientError(500, "internal_error", "Something broke.")
    )
    renderWithProviders(<SuggestionsTab locationId={LOCATION} />)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("We couldn’t load Google’s suggestions")
    expect(
      within(alert).queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })

  it("holds Check Google now for a role the server refuses, and never calls it", async () => {
    const user = userEvent.setup()
    useCapsMock.mockReturnValue(caps({ canEditCanonical: false }))
    serve([])
    const refresh = vi.spyOn(importReviewApi, "refreshImportReview")
    renderWithProviders(<SuggestionsTab locationId={LOCATION} />)

    const check = await screen.findByRole("button", {
      name: "Check Google now",
    })
    expect(check).toHaveAttribute("aria-disabled", "true")
    expect(check).toHaveAccessibleDescription(
      "Only owners and admins can check Google for suggestions."
    )
    expect(
      screen.getByText(
        "Only owners and admins can accept or ignore suggestions"
      )
    ).toBeInTheDocument()
    await user.click(check)
    expect(refresh).not.toHaveBeenCalled()
    // ROLE_REASON is what the gate hands over; the page words it for itself.
    expect(screen.queryByText(ROLE_REASON)).not.toBeInTheDocument()
  })

  it("gives the billing reason, not the role one, on a read-only workspace", async () => {
    useCapsMock.mockReturnValue(caps({ canWrite: false }))
    serve([proposal()])
    renderWithProviders(<SuggestionsTab locationId={LOCATION} />)

    expect(
      await screen.findByText("Suggestions can’t be decided right now")
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        "Only owners and admins can accept or ignore suggestions"
      )
    ).not.toBeInTheDocument()
    for (const name of ["Check Google now", "Accept", "Ignore"]) {
      expect(screen.getByRole("button", { name })).toHaveAccessibleDescription(
        BILLING_REASON
      )
    }
  })

  it("says the check found nothing new when the server raised nothing", async () => {
    const user = userEvent.setup()
    serve([])
    const refresh = vi
      .spyOn(importReviewApi, "refreshImportReview")
      .mockResolvedValue({
        refreshed: true,
        outcomes: { profile: outcome(0), foodMenus: outcome(0) },
      })
    renderWithProviders(<SuggestionsTab locationId={LOCATION} />)

    await user.click(
      await screen.findByRole("button", { name: "Check Google now" })
    )

    await waitFor(() => expect(refresh).toHaveBeenCalledWith(LOCATION, "all"))
    expect(await screen.findByText("Checked with Google")).toBeInTheDocument()
    expect(
      screen.getByText("Nothing new since the last check.")
    ).toBeInTheDocument()
  })

  it("counts what the check raised across both surfaces", async () => {
    const user = userEvent.setup()
    serve([])
    vi.spyOn(importReviewApi, "refreshImportReview").mockResolvedValue({
      refreshed: true,
      outcomes: { profile: outcome(1), foodMenus: outcome(1) },
    })
    renderWithProviders(<SuggestionsTab locationId={LOCATION} />)

    await user.click(
      await screen.findByRole("button", { name: "Check Google now" })
    )

    expect(
      await screen.findByText("2 new suggestions to review.")
    ).toBeInTheDocument()
  })

  it("leaves empty parts out of the summary and names the check one way", async () => {
    serve([
      proposal(),
      proposal({
        id: "22222222-2222-4222-8222-222222222222",
        identityKey: "website",
        fieldKey: "website",
      }),
    ])
    renderWithProviders(<SuggestionsTab locationId={LOCATION} />)

    const summary = await screen.findByText(/suggestions waiting/)
    // The figure is its own span, spaced by margin.
    expect(summary).toHaveTextContent(
      /^2\s?suggestions waiting · 2 business profile$/
    )
    expect(summary).not.toHaveTextContent("food menu")
    expect(
      screen.getByRole("button", { name: "Check Google now" })
    ).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "Refresh from Google" })
    ).not.toBeInTheDocument()
  })
})
