import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({
  query: "",
  replace: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
}))

import { OnboardingMatchLink } from "@/components/setup/onboarding-match-link"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"

import {
  ACCOUNT,
  CHECKED_AT,
  DRAFT,
  HASH,
  USER,
  draftFixture,
  errorResponse,
  jsonResponse,
  stubNetwork,
} from "./onboarding-draft-fixtures"

const REVIEW = "0c7f0e6f-1d4c-4559-a431-f8e1f2b7a104"
const REVIEW_HASH = "b".repeat(64)
const LINK_PATH = `/api/google/accounts/${ACCOUNT}/drafts/${DRAFT}/match-link`
const REVIEWS_PATH = `${LINK_PATH}-reviews`

const draft = draftFixture({
  matchResult: {
    accountId: ACCOUNT,
    connectionId: draftFixture().connectionId,
    checkedAt: CHECKED_AT,
    matches: [
      { name: "googleLocations/m1", location: { title: "Old Crown Pub" } },
      { name: "googleLocations/m2", location: { title: "Old Crown Hotel" } },
      { name: "googleLocations/m3", location: { title: "Old Crown Bar" } },
    ],
  },
})

const accessible = (overrides: Record<string, unknown> = {}) =>
  jsonResponse({
    draftId: DRAFT,
    revision: draft.revision,
    payloadHash: HASH,
    matchCheckedAt: CHECKED_AT,
    observedAt: "2026-10-14T10:06:00.000Z",
    matches: [
      {
        matchName: "googleLocations/m1",
        status: "accessible",
        location: { name: "locations/111", title: "The Old Crown" },
      },
      { matchName: "googleLocations/m2", status: "not_accessible" },
      { matchName: "googleLocations/m3", status: "ambiguous" },
    ],
    ...overrides,
  })

const review = (overrides: Record<string, unknown> = {}) => ({
  id: REVIEW,
  reviewHash: REVIEW_HASH,
  draftId: DRAFT,
  revision: draft.revision,
  payloadHash: HASH,
  accountId: ACCOUNT,
  accountName: "accounts/1",
  connectionId: draft.connectionId,
  clientId: draft.clientId,
  matchCheckedAt: CHECKED_AT,
  matchName: "googleLocations/m1",
  provider: {
    name: "locations/111",
    title: "The Old Crown",
    placeId: "ChIJold",
    address: { regionCode: "GB", addressLines: ["1 High Street"] },
    verified: true,
  },
  localName: "The Old Crown, Camden",
  externalLocationId: null,
  conflicts: [],
  requestedBy: USER,
  approvedBy: null,
  requiresSecondApprover: false,
  canApprove: true,
  observedAt: "2026-10-14T10:07:00.000Z",
  approvalExpiresAt: "2026-10-14T11:07:00.000Z",
  ...overrides,
})

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
    onFinished: vi.fn(),
  }
  const user = userEvent.setup()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <OnboardingMatchLink draft={value} disabled={disabled} {...handlers} />
    </QueryClientProvider>
  )
  return { user, ...handlers }
}

const check = () =>
  screen.getByRole("button", { name: "Check accessible matches" })

describe("OnboardingMatchLink discovery", () => {
  it("shows nothing when matching found no potential match", () => {
    stubNetwork(() => accessible())
    setup(draftFixture())
    expect(screen.queryByText("Link an existing match")).not.toBeInTheDocument()
  })

  it("asks only when told to, naming the saved revision and match check", async () => {
    const { calls } = stubNetwork(() => accessible())
    const { user } = setup()
    expect(calls).toEqual([])
    await user.click(check())
    expect(
      await screen.findByText("Account access checked", { exact: false })
    ).toBeInTheDocument()
    expect(calls).toEqual([
      {
        method: "GET",
        path: `/api/google/accounts/${ACCOUNT}/drafts/${DRAFT}/accessible-matches`,
        query: { expectedRevision: "3", expectedMatchCheckedAt: CHECKED_AT },
        body: undefined,
      },
    ])
  })

  it("offers selection only for an accessible match and explains each other state", async () => {
    stubNetwork(() => accessible())
    const { user } = setup()
    await user.click(check())
    expect(
      await screen.findByText("Accessible in this account: The Old Crown")
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("button", { name: "Select this existing match" })
    ).toHaveLength(1)
    expect(
      screen.getByText(/Not found in this selected account\./)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Multiple resources share this identity\./)
    ).toBeInTheDocument()
  })

  it("says no match can be linked when none is accessible", async () => {
    stubNetwork(() =>
      accessible({
        matches: [
          { matchName: "googleLocations/m2", status: "not_accessible" },
        ],
      })
    )
    const { user } = setup()
    await user.click(check())
    expect(
      await screen.findByText(
        "No unambiguous accessible match is available for linking in this account."
      )
    ).toBeInTheDocument()
  })

  it("refuses an answer for another revision of the draft", async () => {
    stubNetwork(() => accessible({ revision: 2 }))
    const { user } = setup()
    await user.click(check())
    // The component throws its own "Restore the saved draft…" 409, but the
    // shared error copy shows the generic 409 sentence (see the handoff).
    expect(
      await screen.findByText(
        /This changed since you loaded it\. Refresh and try again\./
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Select this existing match" })
    ).not.toBeInTheDocument()
  })

  it("reports a failed check without implying a new listing is needed", async () => {
    stubNetwork(() => errorResponse(503, "google_unavailable"))
    const { user } = setup()
    await user.click(check())
    expect(
      await screen.findByText(
        /The account check did not finish\. This does not mean a new listing is needed\./
      )
    ).toBeInTheDocument()
  })

  it("is disabled, with the reason, while another action is under way", () => {
    stubNetwork(() => accessible())
    setup(draft, true)
    expect(check()).toBeDisabled()
    expect(
      screen.getByText(/Wait for the current action to finish/)
    ).toBeInTheDocument()
  })
})

describe("OnboardingMatchLink preview", () => {
  async function selectFirst(user: ReturnType<typeof userEvent.setup>) {
    await user.click(check())
    await user.click(
      await screen.findByRole("button", { name: "Select this existing match" })
    )
  }

  it("starts the local name from the draft's title and tracks the choice as unsaved", async () => {
    stubNetwork(() => accessible())
    const { user, onDirtyChange } = setup()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    await selectFirst(user)
    expect(
      screen.getByLabelText("Local name for this existing listing")
    ).toHaveValue("The Old Crown")
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect(
      screen.getByRole("button", { name: "Selected for link review" })
    ).toHaveAttribute("aria-pressed", "true")
    await user.click(
      screen.getByRole("button", { name: "Discard link decision" })
    )
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    expect(
      screen.queryByLabelText("Local name for this existing listing")
    ).not.toBeInTheDocument()
  })

  it("will not review a link with a blank local name", async () => {
    stubNetwork(() => accessible())
    const { user } = setup()
    await selectFirst(user)
    await user.clear(
      screen.getByLabelText("Local name for this existing listing")
    )
    expect(
      screen.getByRole("button", { name: "Review existing listing link" })
    ).toBeDisabled()
  })

  it("sends the selection with the trimmed local name and opens the review it returns", async () => {
    const { calls } = stubNetwork((url, init) =>
      init?.method === "POST" ? jsonResponse(review()) : accessible()
    )
    const { user } = setup()
    await selectFirst(user)
    const name = screen.getByLabelText("Local name for this existing listing")
    await user.clear(name)
    await user.type(name, "  The Old Crown, Camden  ")
    await user.click(
      screen.getByRole("button", { name: "Review existing listing link" })
    )
    await waitFor(() => expect(nav.replace).toHaveBeenCalled())

    const post = calls.find((call) => call.method === "POST")
    expect(post).toEqual({
      method: "POST",
      path: REVIEWS_PATH,
      query: {},
      body: {
        expectedRevision: 3,
        expectedMatchCheckedAt: CHECKED_AT,
        matchName: "googleLocations/m1",
        localName: "The Old Crown, Camden",
      },
    })
    expect(nav.replace).toHaveBeenCalledWith(
      `/setup?onboardingMatchLinkReview=${REVIEW}`,
      { scroll: false }
    )
  })

  it("shows a pending state while the review is prepared, then the refusal", async () => {
    let refuse = () => {}
    const refused = new Promise<void>((resolve) => (refuse = resolve))
    stubNetwork(async (_url, init) => {
      if (init?.method !== "POST") return accessible()
      await refused
      return errorResponse(409, "onboarding_matches_stale", "stale")
    })
    const { user, onBusyChange } = setup()
    await selectFirst(user)
    await user.click(
      screen.getByRole("button", { name: "Review existing listing link" })
    )
    expect(
      await screen.findByText("Preparing link review…")
    ).toBeInTheDocument()
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
    expect(
      screen.getByRole("button", { name: "Discard link decision" })
    ).toBeDisabled()
    refuse()
    expect(
      await screen.findByText(
        "This changed since you loaded it. Refresh and try again."
      )
    ).toBeInTheDocument()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(nav.replace).not.toHaveBeenCalled()
  })
})

describe("OnboardingMatchLink review", () => {
  beforeEach(() => {
    nav.query = `onboardingMatchLinkReview=${REVIEW}`
  })

  it("restores the review by id and shows the exact mapping to approve", async () => {
    const { calls } = stubNetwork(() => jsonResponse(review()))
    setup()
    expect(
      await screen.findByText("Review this exact mapping.", { exact: false })
    ).toBeInTheDocument()
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: `${REVIEWS_PATH}/${REVIEW}`,
    })
    expect(screen.getByText("The Old Crown, Camden")).toBeInTheDocument()
    expect(screen.getByText("ChIJold")).toBeInTheDocument()
    expect(screen.getByText("Google reports verified")).toBeInTheDocument()
    expect(screen.getByText("1 High Street")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Approve existing listing link" })
    ).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "Link approved existing listing" })
    ).not.toBeInTheDocument()
  })

  it("approves with the hash of the review on screen, then needs a confirmation to link", async () => {
    const { calls } = stubNetwork((_url, init) =>
      init?.method === "POST"
        ? jsonResponse(review({ approvedBy: USER }))
        : jsonResponse(review())
    )
    const { user, onFinished } = setup()
    await user.click(
      await screen.findByRole("button", {
        name: "Approve existing listing link",
      })
    )
    expect(
      await screen.findByText("This mapping is approved.")
    ).toBeInTheDocument()
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      path: `${REVIEWS_PATH}/${REVIEW}`,
      body: { expectedReviewHash: REVIEW_HASH },
    })
    const link = screen.getByRole("button", {
      name: "Link approved existing listing",
    })
    expect(link).toBeDisabled()
    await user.click(
      screen.getByRole("checkbox", {
        name: "Link this existing Google resource to the reviewed local listing.",
      })
    )
    await user.click(link)
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
    expect(calls.filter((call) => call.method === "POST").at(-1)).toMatchObject(
      {
        path: LINK_PATH,
        body: { reviewId: REVIEW, expectedReviewHash: REVIEW_HASH },
      }
    )
  })

  it("lets the parent recover when the link fails, and says to restore the status first", async () => {
    stubNetwork((url, init) =>
      init?.method === "POST"
        ? errorResponse(503, "google_unavailable")
        : jsonResponse(review({ approvedBy: USER }))
    )
    const { user, onFinished } = setup()
    await user.click(
      await screen.findByRole("checkbox", {
        name: "Link this existing Google resource to the reviewed local listing.",
      })
    )
    await user.click(
      screen.getByRole("button", { name: "Link approved existing listing" })
    )
    expect(
      await screen.findByText(/Restore link status before retrying\./)
    ).toBeInTheDocument()
    expect(onFinished).toHaveBeenCalled()
  })

  it("blocks approval and names each conflict", async () => {
    stubNetwork(() =>
      jsonResponse(review({ conflicts: ["local_name", "existing_link"] }))
    )
    setup()
    expect(
      await screen.findByText(
        "Resolve these mapping conflicts before approval."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "The proposed local name already exists. Choose a distinct name."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "This resource already has a local link, which may be inactive."
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Approve existing listing link" })
    ).not.toBeInTheDocument()
  })

  it("asks for a different approver when the requester may not approve", async () => {
    stubNetwork(() =>
      jsonResponse(review({ requiresSecondApprover: true, canApprove: false }))
    )
    setup()
    expect(
      await screen.findByText(
        /A different authorised owner or admin must approve this exact mapping/
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Approve existing listing link" })
    ).toBeDisabled()
  })

  it("says the review did not load, retries, and can start a fresh review", async () => {
    let attempts = 0
    const { calls } = stubNetwork(() =>
      ++attempts === 1
        ? errorResponse(404, "not_found")
        : jsonResponse(review())
    )
    const { user } = setup()
    expect(
      await screen.findByText("The link review didn’t load")
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Retry restoring link review" })
    )
    expect(
      await screen.findByText("Review this exact mapping.", { exact: false })
    ).toBeInTheDocument()
    expect(calls).toHaveLength(2)
  })

  it("starts a fresh review by dropping the review from the address", async () => {
    stubNetwork(() => errorResponse(404, "not_found"))
    const { user } = setup()
    await screen.findByText("The link review didn’t load")
    await user.click(
      screen.getByRole("button", { name: "Start a fresh link review" })
    )
    expect(nav.replace).toHaveBeenCalledWith("/setup?", { scroll: false })
  })
})
