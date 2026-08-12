import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InboxView } from "@/components/inbox/inbox-view"
import { QueryProvider } from "@/lib/queries/provider"
import { Toaster } from "@/components/ui/toast"
import type { ReviewDetail as ReviewDetailData, ReviewRow } from "@/lib/api/reviews"
import { __resetDraftSources } from "@/lib/api/draft-stash"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as draftMutations from "@/lib/queries/use-draft-mutations"
import * as reviewsHook from "@/lib/queries/use-reviews"
import * as countsHook from "@/lib/queries/use-review-counts"
import * as connHealthHook from "@/lib/queries/use-connection-health"
import * as locationsApi from "@/lib/api/locations"

const push = vi.fn()
const replace = vi.fn()
// Stable across renders (like the real hook when the URL hasn't changed) —
// a fresh instance per call would make every `useMemo([searchParams])` in
// `InboxViewInner` recompute every render, which is unnecessary noise here.
const INITIAL_PARAMS = new URLSearchParams("selected=rev-1&rating=4")

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => INITIAL_PARAMS,
}))

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: "rev-1",
    location: { id: "loc-1", name: "Riverside" },
    reviewer: { displayName: "Sam Traveller", isAnonymous: false, profilePhotoUrl: null },
    rating: 4,
    text: "Great stay, would return.",
    detectedLanguageCode: "en",
    languageConfidence: 0.9,
    createTime: "2026-07-30T10:00:00.000Z",
    updateTime: "2026-07-30T10:00:00.000Z",
    hasMedia: false,
    workflowStatus: "drafted",
    draftId: "d1",
    draftBody: "Seed",
    verificationStatus: "pass",
    replyStatus: null,
    googleReplyState: null,
    googlePolicyViolation: null,
    replyBody: null,
    syncStatus: "succeeded",
    capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
    ...overrides,
  }
}

function reviewDetail(): ReviewDetailData {
  return {
    review: {
      id: "rev-1",
      reviewerDisplayName: "Sam Traveller",
      reviewerIsAnonymous: false,
      reviewerProfilePhotoUrl: null,
      rating: 4,
      text: "Great stay, would return.",
      detectedLanguageCode: "en",
      languageConfidence: 0.9,
      createTime: "2026-07-30T10:00:00.000Z",
      updateTime: "2026-07-30T10:00:00.000Z",
      hasMedia: false,
      workflowStatus: "drafted",
      locationId: "loc-1",
      locationName: "Riverside",
      timezone: "Europe/London",
      verified: true,
      media: [],
      drafts: [
        {
          id: "d1",
          source: "ai",
          body: "Seed",
          bodyBytes: 4,
          evidenceHash: "h",
          modelName: "m",
          verificationStatus: "pass",
          createdAt: "2026-07-30T10:05:00.000Z",
        },
      ],
      reply: null,
      timeline: [],
      capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
      latestVerification: null,
    },
  }
}

// Same shape/rationale as reply-composer.test.tsx's `mockMutation()`: `any`
// generics are the only instantiation assignable to both
// useGenerateOrSaveDraft's and useVerifyDraft's exact mutation-result types
// (see that file's comment for why `never`/`unknown` both fail `tsc` here).
function mockMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see reply-composer.test.tsx
  } as unknown as UseMutationResult<any, Error, any>
}

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
  push.mockClear()
  replace.mockClear()

  // jsdom does not implement matchMedia; the auto-select effect's isDesktop
  // check calls it unconditionally. `selected` is already set in every test
  // here, so autoSelectId short-circuits before `isDesktop` matters — this
  // just needs to exist, not resolve to any particular value.
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))

  vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
    data: { pages: [{ items: [row()], nextCursor: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof reviewsHook.useReviews>)

  vi.spyOn(countsHook, "useReviewCounts").mockReturnValue({
    data: { total: 1, byStatus: {} },
  } as unknown as UseQueryResult<{ total: number; byStatus: Record<string, number> }>)

  vi.spyOn(connHealthHook, "useConnectionHealth").mockReturnValue({
    status: "connected",
    label: "Live data",
  })

  vi.spyOn(locationsApi, "fetchLocations").mockResolvedValue({ locations: [] })

  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
    data: reviewDetail(),
  } as UseQueryResult<ReviewDetailData>)

  vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation())
  vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderInbox() {
  return render(
    <QueryProvider>
      <Toaster>
        <InboxView />
      </Toaster>
    </QueryProvider>
  )
}

async function dirtyComposer(user: ReturnType<typeof userEvent.setup>) {
  const textbox = screen.getByRole("textbox", { name: "Your reply" })
  await user.type(textbox, " extra")
  return textbox
}

// Each of these nav affordances drops `selected` from the URL, which would
// unmount the (dirty) composer — Task 6 fix round 1: every one must gate
// through the same dirtyGate() used by onSelect, prompting the discard
// AlertDialog and aborting on "Keep editing" so the edit and the selection
// both survive.
describe("InboxView — dirty-guard gates nav that clears the selection", () => {
  it("gates a filter change (removing the active rating chip)", async () => {
    const user = userEvent.setup()
    renderInbox()
    const textbox = await dirtyComposer(user)

    await user.click(screen.getByRole("button", { name: "Remove rating filter" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(replace).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Seed extra")

    await user.click(screen.getByRole("button", { name: "Remove rating filter" }))
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain("selected=")
  })

  it("gates a queue change", async () => {
    const user = userEvent.setup()
    renderInbox()
    const textbox = await dirtyComposer(user)

    await user.click(screen.getByRole("tab", { name: /Needs reply/ }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(replace).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Seed extra")

    await user.click(screen.getByRole("tab", { name: /Needs reply/ }))
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain("selected=")
  })

  it("gates 'Back to reviews'", async () => {
    const user = userEvent.setup()
    renderInbox()
    const textbox = await dirtyComposer(user)

    await user.click(screen.getByRole("button", { name: "Back to reviews" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(replace).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Seed extra")

    await user.click(screen.getByRole("button", { name: "Back to reviews" }))
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain("selected=")
  })

  // Not one of the three named in review, but the same real gap: "Clear all
  // filters" also omits `selected` from its next state, so it drops the
  // selection exactly like the explicit `selected: undefined` handlers.
  it("gates 'Clear all filters'", async () => {
    const user = userEvent.setup()
    renderInbox()
    const textbox = await dirtyComposer(user)

    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(replace).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Seed extra")

    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain("selected=")
  })
})

// A failed list fetch must not render as "No reviews yet" (the genuinely
// empty-queue copy) with no way to recover -- that silently mislabels a real
// error as an empty inbox.
describe("InboxView — list fetch failure", () => {
  it("shows a retry affordance instead of the empty-queue copy", async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch,
    } as unknown as ReturnType<typeof reviewsHook.useReviews>)

    renderInbox()

    expect(screen.getByText("We could not load your reviews.")).toBeInTheDocument()
    expect(screen.queryByText("No reviews yet")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
