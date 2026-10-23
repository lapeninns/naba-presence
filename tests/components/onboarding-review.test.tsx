import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ query: "", replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
}))

import { OnboardingReview } from "@/components/setup/onboarding-review"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"

import {
  ACCOUNT,
  CHECKED_AT,
  CLIENT,
  CONNECTION,
  DRAFT,
  USER,
  draftFixture,
  errorResponse,
  jsonResponse,
  stubNetwork,
} from "./onboarding-draft-fixtures"

const REVIEW = "0c7f0e6f-1d4c-4559-a431-f8e1f2b7a104"
const REVIEW_HASH = "c".repeat(64)
const DRAFT_PATH = `/api/google/accounts/${ACCOUNT}/drafts/${DRAFT}`

const draft = draftFixture({
  matchResult: {
    accountId: ACCOUNT,
    connectionId: CONNECTION,
    checkedAt: CHECKED_AT,
    matches: [
      { name: "googleLocations/m1", location: { title: "Old Crown Pub" } },
      { name: "googleLocations/m2", location: {} },
    ],
  },
})

const reviewFixture = (overrides: Record<string, unknown> = {}) => ({
  id: REVIEW,
  draftId: DRAFT,
  revision: draft.revision,
  accountId: ACCOUNT,
  accountName: "accounts/1",
  connectionId: CONNECTION,
  clientId: CLIENT,
  providerRequestId: USER,
  payload: {
    title: "The Old Crown",
    languageCode: "en-GB",
    profile: { description: "A pub." },
    openInfo: {
      status: "OPEN",
      openingDate: { year: 2020, month: 3 },
    },
    regularHours: {
      periods: [
        {
          openDay: "MONDAY",
          openTime: { hours: 9, minutes: 0 },
          closeDay: "MONDAY",
          closeTime: { hours: 17, minutes: 0 },
        },
      ],
    },
    specialHours: {
      specialHourPeriods: [
        { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
      ],
    },
    serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB" },
    relationshipData: {
      parentLocation: { placeId: "P1", relationType: "DEPARTMENT_OF" },
    },
    labels: ["Team"],
  },
  matchResult: draft.matchResult,
  decision: {
    action: "create_new",
    acknowledgedMatchNames: ["googleLocations/m1", "googleLocations/m2"],
    reason: "Different premises.",
  },
  reviewHash: REVIEW_HASH,
  requestedBy: USER,
  approvedBy: null,
  requiresSecondApprover: false,
  canApprove: true,
  validatedAt: "2026-10-14T10:07:00.000Z",
  approvalExpiresAt: "2026-10-14T11:07:00.000Z",
  ...overrides,
})

const creation = {
  id: REVIEW,
  draftId: DRAFT,
  reviewId: REVIEW,
  executionState: "accepted",
  confirmationState: "pending",
  linkState: "pending",
  providerResourceName: null,
  locationId: null,
  errorCode: null,
  updatedAt: "2026-10-14T10:09:00.000Z",
}

beforeEach(() => {
  nav.query = ""
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function setup(value: GoogleOnboardingDraft = draft, disabled = false) {
  const handlers = {
    onBusyChange: vi.fn(),
    onDirtyChange: vi.fn(),
    onCreated: vi.fn(),
  }
  const user = userEvent.setup()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <OnboardingReview draft={value} disabled={disabled} {...handlers} />
    </QueryClientProvider>
  )
  return { user, ...handlers }
}

const validate = () =>
  screen.getByRole("button", { name: "Validate and review creation" })
const reasonBox = () =>
  screen.getByLabelText("Why is a separate listing needed?")

describe("OnboardingReview decision", () => {
  it("shows nothing until matching has run", () => {
    stubNetwork(() => jsonResponse({}))
    setup(draftFixture())
    expect(
      screen.queryByText("Create a separate listing")
    ).not.toBeInTheDocument()
  })

  it("needs a reason and every potential match acknowledged before validating", async () => {
    stubNetwork(() => jsonResponse({}))
    const { user } = setup()
    expect(validate()).toBeDisabled()
    await user.type(reasonBox(), "Different premises.")
    expect(validate()).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", {
        name: "I reviewed the potential match: Old Crown Pub",
      })
    )
    expect(validate()).toBeDisabled()
    // A match with no title is named by its resource name.
    await user.click(
      screen.getByRole("checkbox", {
        name: "I reviewed the potential match: googleLocations/m2",
      })
    )
    expect(validate()).toBeEnabled()
  })

  it("will not validate a draft without a name or a language", async () => {
    stubNetwork(() => jsonResponse({}))
    const { user } = setup({
      ...draft,
      payload: { title: "The Old Crown" },
    })
    await user.type(reasonBox(), "Different premises.")
    for (const box of screen.getAllByRole("checkbox")) await user.click(box)
    expect(validate()).toBeDisabled()
  })

  it("reports a started decision as unsaved until it is discarded", async () => {
    stubNetwork(() => jsonResponse({}))
    const { user, onDirtyChange } = setup()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await user.type(reasonBox(), "x")
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    await user.click(
      screen.getByRole("button", { name: "Discard creation decision" })
    )
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    expect(reasonBox()).toHaveValue("")
  })

  async function decide(user: ReturnType<typeof userEvent.setup>) {
    await user.type(reasonBox(), "  Different premises.  ")
    for (const box of screen.getAllByRole("checkbox")) await user.click(box)
    await user.click(validate())
  }

  it("sends the revision, the match check, the acknowledged matches and the trimmed reason, then opens the review", async () => {
    const { calls } = stubNetwork(() => jsonResponse(reviewFixture()))
    const { user } = setup()
    await decide(user)
    await waitFor(() => expect(nav.replace).toHaveBeenCalled())
    expect(calls).toEqual([
      {
        method: "POST",
        path: `${DRAFT_PATH}/reviews`,
        query: {},
        body: {
          expectedRevision: 3,
          expectedMatchCheckedAt: CHECKED_AT,
          decision: {
            action: "create_new",
            acknowledgedMatchNames: [
              "googleLocations/m1",
              "googleLocations/m2",
            ],
            reason: "Different premises.",
          },
        },
      },
    ])
    expect(nav.replace).toHaveBeenCalledWith(
      `/setup?onboardingReview=${REVIEW}`,
      {
        scroll: false,
      }
    )
  })

  it("is pending while Google validates, and locks the form meanwhile", async () => {
    let answer = () => {}
    const held = new Promise<void>((resolve) => (answer = resolve))
    stubNetwork(async () => {
      await held
      return jsonResponse(reviewFixture())
    })
    const { user, onBusyChange } = setup()
    await decide(user)
    expect(
      await screen.findByText("Validating with Google…")
    ).toBeInTheDocument()
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    expect(reasonBox()).toBeDisabled()
    answer()
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
  })

  it("explains a 422 as unvalidated business details and keeps the decision", async () => {
    stubNetwork(() => errorResponse(422, "validation_failed"))
    const { user } = setup()
    await decide(user)
    expect(
      await screen.findByText(
        "The proposed business details could not be validated. Check the saved business details and service areas, then try validation again."
      )
    ).toBeInTheDocument()
    expect(reasonBox()).toHaveValue("  Different premises.  ")
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it("shows the shared copy for any other failure", async () => {
    stubNetwork(() => errorResponse(429, "rate_limited"))
    const { user } = setup()
    await decide(user)
    expect(
      await screen.findByText("Too many requests. Wait a moment and try again.")
    ).toBeInTheDocument()
  })

  it("is locked, and reported busy, while the parent says another action is under way", () => {
    stubNetwork(() => jsonResponse({}))
    const { onBusyChange } = setup(draft, true)
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    expect(reasonBox()).toBeDisabled()
    expect(validate()).toBeDisabled()
  })
})

describe("OnboardingReview restored review", () => {
  beforeEach(() => {
    nav.query = `onboardingReview=${REVIEW}`
  })

  it("restores the review by id and shows what will be created, in words", async () => {
    const { calls } = stubNetwork(() => jsonResponse(reviewFixture()))
    setup()
    expect(
      await screen.findByText(/Google validation completed\./)
    ).toBeInTheDocument()
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: `${DRAFT_PATH}/reviews/${REVIEW}`,
    })
    const facts = document.querySelector("dl") as HTMLElement
    const rows = Array.from(facts.querySelectorAll("dt")).map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ])
    expect(rows).toEqual(
      expect.arrayContaining([
        ["title", "The Old Crown"],
        ["Opening state", "Open"],
        ["Opening date", "2020-03 (day not supplied)"],
        ["Regular hours 1", "Monday 09:00 to Monday 17:00"],
        ["Special hours 1", "2026-12-25: Closed"],
        ["Business description", "A pub."],
        ["Parent business place ID", "P1"],
        ["Relationship to parent", "Department"],
        ["Private label 1", "Team"],
      ])
    )
    expect(screen.getByText("At customer locations only")).toBeInTheDocument()
    expect(screen.getByText("Different premises.")).toBeInTheDocument()
    expect(
      screen.getByText(/2 potential\s+matches acknowledged/)
    ).toBeInTheDocument()
  })

  it("approves with the hash of the review on screen", async () => {
    const { calls } = stubNetwork((_url, init) =>
      init?.method === "POST"
        ? jsonResponse(reviewFixture({ approvedBy: USER }))
        : jsonResponse(reviewFixture())
    )
    const { user } = setup()
    await user.click(
      await screen.findByRole("button", { name: "Approve creation details" })
    )
    expect(
      await screen.findByText("These creation details are approved.")
    ).toBeInTheDocument()
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      path: `${DRAFT_PATH}/reviews/${REVIEW}`,
      body: { expectedReviewHash: REVIEW_HASH },
    })
    expect(
      screen.queryByRole("button", { name: "Approve creation details" })
    ).not.toBeInTheDocument()
  })

  it("asks for a different approver and will not let this person approve", async () => {
    stubNetwork(() =>
      jsonResponse(
        reviewFixture({ requiresSecondApprover: true, canApprove: false })
      )
    )
    setup()
    expect(
      await screen.findByText(
        /A different authorised owner or admin must approve this review/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Approve creation details" })
    ).toBeDisabled()
  })

  it("needs a confirmation before creating, then submits the approved review", async () => {
    const { calls } = stubNetwork((_url, init) =>
      init?.method === "POST"
        ? jsonResponse(creation)
        : jsonResponse(reviewFixture({ approvedBy: USER }))
    )
    const { user, onCreated } = setup()
    const create = await screen.findByRole("button", {
      name: "Create approved Google listing",
    })
    expect(create).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", {
        name: "I am ready to create this public Google listing with the reviewed details.",
      })
    )
    await user.click(create)
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      {
        method: "POST",
        path: `${DRAFT_PATH}/creation`,
        query: {},
        body: { reviewId: REVIEW, expectedReviewHash: REVIEW_HASH },
      },
    ])
  })

  it("tells the parent to look at the outcome when submitting fails, and says to refresh first", async () => {
    stubNetwork((_url, init) =>
      init?.method === "POST"
        ? errorResponse(503, "google_unavailable")
        : jsonResponse(reviewFixture({ approvedBy: USER }))
    )
    const { user, onCreated } = setup()
    await user.click(
      await screen.findByRole("checkbox", {
        name: "I am ready to create this public Google listing with the reviewed details.",
      })
    )
    await user.click(
      screen.getByRole("button", { name: "Create approved Google listing" })
    )
    expect(
      await screen.findByText(
        /Refresh the\s+review and outcome before retrying\./
      )
    ).toBeInTheDocument()
    expect(onCreated).toHaveBeenCalled()
  })

  it("says the review did not load, retries, and can start a fresh one", async () => {
    let attempts = 0
    const { calls } = stubNetwork(() =>
      ++attempts === 1
        ? errorResponse(404, "not_found")
        : jsonResponse(reviewFixture())
    )
    const { user } = setup()
    expect(
      await screen.findByText("The creation review didn’t load")
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Retry restoring review" })
    )
    expect(
      await screen.findByText(/Google validation completed\./)
    ).toBeInTheDocument()
    expect(calls).toHaveLength(2)
    await user.click(
      screen.getByRole("button", { name: "Start a fresh review" })
    )
    expect(nav.replace).toHaveBeenCalledWith("/setup?", { scroll: false })
  })

  it("shows a pending message while the review is restored", async () => {
    stubNetwork(() => new Promise<Response>(() => {}))
    setup()
    expect(
      await screen.findByText("Restoring creation review…")
    ).toBeInTheDocument()
    expect(
      within(document.body).queryByText("Approve creation details")
    ).not.toBeInTheDocument()
  })
})
