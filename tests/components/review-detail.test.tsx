import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewDetail } from "@/components/inbox/review-detail"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"
import { PUBLISH_PULSE_EVENT, PUBLISH_PULSE_MS } from "@/lib/inbox/events"

function fakeDetail(value: Partial<UseQueryResult<ReviewDetailData>>) {
  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue(
    value as UseQueryResult<ReviewDetailData>
  )
}

const detail: ReviewDetailData = {
  review: {
    id: "rev-1",
    reviewerDisplayName: "Sam Traveller",
    reviewerIsAnonymous: false,
    reviewerProfilePhotoUrl: null,
    rating: 2,
    text: "Slow service at breakfast.",
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
        body: "We are sorry to hear that.",
        bodyBytes: 26,
        evidenceHash: "h",
        modelName: "gpt",
        verificationStatus: "warn",
        createdAt: "2026-07-30T10:05:00.000Z",
      },
    ],
    reply: null,
    timeline: [],
    capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
    latestVerification: null,
  },
}

afterEach(() => vi.restoreAllMocks())

describe("ReviewDetail", () => {
  it("renders a busy state while the detail query is pending", () => {
    fakeDetail({ isPending: true, isError: false })
    const { container } = render(<ReviewDetail reviewId="rev-1" />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("renders the conversation and the reviewer's words", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    render(<ReviewDetail reviewId="rev-1" />)
    expect(screen.getByText("Slow service at breakfast.")).toBeInTheDocument()
    expect(screen.getByText("Riverside")).toBeInTheDocument()
  })

  it("reads a one-star rating as singular, not '1 stars'", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: { review: { ...detail.review, rating: 1 } },
    })
    render(<ReviewDetail reviewId="rev-1" />)
    expect(screen.getByLabelText("1 star")).toBeInTheDocument()
    expect(screen.queryByLabelText("1 stars")).not.toBeInTheDocument()
  })

  it("states the situation and the next step in the header", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    render(<ReviewDetail reviewId="rev-1" />)
    const strip = screen.getByRole("status")
    expect(strip).toHaveTextContent("Ready to publish")
    expect(strip).toHaveTextContent("The draft has been verified.")
  })

  // The old pane printed Google's two-language blob as one paragraph under a
  // single `lang`, so the same sentence appeared to be typed twice.
  it("shows the translation first and keeps the original one click away", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: {
        review: {
          ...detail.review,
          detectedLanguageCode: "it",
          text: "(Translated by Google) The food is excellent. (Original) Si mangia benissimo.",
        },
      },
    })
    render(<ReviewDetail reviewId="rev-1" />)

    expect(screen.getByText("The food is excellent.")).toBeInTheDocument()
    expect(screen.queryByText(/Si mangia benissimo/)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Show original" }))
    const original = screen.getByText(/Si mangia benissimo/)
    expect(original).toBeInTheDocument()
    expect(original.closest("blockquote")).toHaveAttribute("lang", "it")
    expect(screen.getByText("Translated from Italian")).toBeInTheDocument()
  })

  // The composer holds the live reply, so repeating it above the field would
  // be the same words twice — exactly what the old pane did.
  it("stays quiet about the live reply when the composer already holds it", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: {
        review: {
          ...detail.review,
          workflowStatus: "published",
          drafts: [
            {
              ...detail.review.drafts[0]!,
              body: "Sorry about that — we have added staff at breakfast.",
            },
          ],
          reply: {
            id: "reply-1",
            body: "Sorry about that — we have added staff at breakfast.",
            publishStatus: "published",
            googleReplyState: "APPROVED",
            googlePolicyViolation: null,
            googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
          },
        },
      },
    })
    render(<ReviewDetail reviewId="rev-1" />)
    expect(screen.queryByText("Live on Google")).not.toBeInTheDocument()
  })

  it("surfaces the live reply, behind a disclosure, when the draft has moved on", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: {
        review: {
          ...detail.review,
          workflowStatus: "drafted",
          drafts: [{ ...detail.review.drafts[0]!, body: "A newer, better answer." }],
          reply: {
            id: "reply-1",
            body: "The words that are on Google today.",
            publishStatus: "published",
            googleReplyState: "APPROVED",
            googlePolicyViolation: null,
            googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
          },
        },
      },
    })
    render(<ReviewDetail reviewId="rev-1" />)

    expect(screen.getByText("Live on Google")).toBeInTheDocument()
    expect(screen.getByText("30 Jul, 12:00")).toBeInTheDocument()
    // Collapsed until asked for.
    expect(
      screen.queryByText("The words that are on Google today.")
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: /differs from the reply below/ })
    )
    expect(
      screen.getByText("The words that are on Google today.")
    ).toBeInTheDocument()
  })

  // "Your published reply" was the label for every publish_status, including
  // the five that mean the reply is not on Google.
  it("does not call a reply awaiting approval published", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: {
        review: {
          ...detail.review,
          workflowStatus: "awaiting_approval",
          drafts: [{ ...detail.review.drafts[0]!, body: "A newer answer." }],
          reply: {
            id: "reply-1",
            body: "Sorry about that.",
            publishStatus: "awaiting_approval",
            googleReplyState: null,
            googlePolicyViolation: null,
            googleReplyUpdatedAt: null,
          },
        },
      },
    })
    render(<ReviewDetail reviewId="rev-1" />)
    expect(
      screen.getByRole("button", { name: /differs from the reply below/ })
    ).toHaveTextContent("Waiting for approval")
    expect(screen.queryByText("Live on Google")).not.toBeInTheDocument()
  })

  it("skips media rows that carry neither a thumbnail nor a video", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: {
        review: {
          ...detail.review,
          media: [
            { id: "m1", thumbnailUrl: null, thumbnailLabel: null, videoUrl: null },
            {
              id: "m2",
              thumbnailUrl: "https://example.test/a.jpg",
              thumbnailLabel: "Breakfast buffet",
              videoUrl: null,
            },
          ],
        },
      },
    })
    render(<ReviewDetail reviewId="rev-1" />)
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
    expect(
      screen.getByRole("button", { name: "Open Breakfast buffet" })
    ).toBeInTheDocument()
  })

  it("opens attached media in a lightbox", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: {
        review: {
          ...detail.review,
          media: [
            {
              id: "m2",
              thumbnailUrl: "https://example.test/a.jpg",
              thumbnailLabel: "Breakfast buffet",
              videoUrl: null,
            },
          ],
        },
      },
    })
    render(<ReviewDetail reviewId="rev-1" />)
    await user.click(screen.getByRole("button", { name: "Open Breakfast buffet" }))
    expect(screen.getByRole("dialog", { name: "Breakfast buffet" })).toBeInTheDocument()
    expect(screen.getByAltText("Breakfast buffet")).toBeInTheDocument()
  })

  it("lets operators step through multiple media items in the lightbox", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: {
        review: {
          ...detail.review,
          media: [
            {
              id: "m1",
              thumbnailUrl: "https://example.test/a.jpg",
              thumbnailLabel: "Breakfast buffet",
              videoUrl: null,
            },
            {
              id: "m2",
              thumbnailUrl: "https://example.test/b.jpg",
              thumbnailLabel: "Lobby",
              videoUrl: null,
            },
          ],
        },
      },
    })
    render(<ReviewDetail reviewId="rev-1" />)
    await user.click(screen.getByRole("button", { name: "Open Breakfast buffet" }))
    expect(screen.getByText("1 of 2")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next media" }))
    expect(screen.getByRole("dialog", { name: "Lobby" })).toBeInTheDocument()
    expect(screen.getByText("2 of 2")).toBeInTheDocument()
  })

  it("keeps a footer action skeleton while the detail is loading", () => {
    fakeDetail({ isPending: true, isError: false })
    const { container } = render(
      <ReviewDetail
        reviewId="rev-1"
        actions={<button type="button">Publish reply</button>}
      />
    )
    expect(screen.queryByRole("button", { name: "Publish reply" })).not.toBeInTheDocument()
    expect(container.querySelector("footer")).not.toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  // The success ring must outlive the event tick: InboxView waits the same
  // PUBLISH_PULSE_MS before navigating away, so this is what the operator
  // actually sees between "Publish" and the next review.
  it("pulses the situation strip for the shared pulse duration after a publish", () => {
    vi.useFakeTimers()
    try {
      fakeDetail({ isPending: false, isError: false, data: detail })
      render(<ReviewDetail reviewId="rev-1" />)
      const strip = screen.getByRole("status")
      expect(strip).not.toHaveClass("ring-2")

      // Another review's publish is not this strip's business.
      act(() => {
        window.dispatchEvent(
          new CustomEvent(PUBLISH_PULSE_EVENT, { detail: { reviewId: "rev-9" } })
        )
      })
      expect(strip).not.toHaveClass("ring-2")

      act(() => {
        window.dispatchEvent(
          new CustomEvent(PUBLISH_PULSE_EVENT, { detail: { reviewId: "rev-1" } })
        )
      })
      expect(strip).toHaveClass("ring-2")

      act(() => {
        vi.advanceTimersByTime(PUBLISH_PULSE_MS - 1)
      })
      expect(strip).toHaveClass("ring-2")

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(strip).not.toHaveClass("ring-2")
    } finally {
      vi.useRealTimers()
    }
  })

  it("says so plainly when there is a rating but no written review", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: { review: { ...detail.review, text: null } },
    })
    render(<ReviewDetail reviewId="rev-1" />)
    expect(screen.getByText("A rating with no written review.")).toBeInTheDocument()
  })
})
