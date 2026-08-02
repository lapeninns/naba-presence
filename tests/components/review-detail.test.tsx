import { render, screen } from "@testing-library/react"
import type { UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewDetail } from "@/components/inbox/review-detail"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"

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
})
