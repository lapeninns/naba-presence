import { describe, expect, it } from "vitest"

import {
  googleAccountsRequest,
  googleBatchReviewsRequest,
  googleNotificationSettingRequest,
  googleReplyRequest,
} from "@/lib/domain/google-contract"

describe("Google API request contracts", () => {
  it("builds a paginated account-list request", () => {
    const first = new URL(googleAccountsRequest().url)
    expect(first.searchParams.get("pageSize")).toBe("20")
    expect(first.searchParams.has("pageToken")).toBe(false)

    const next = new URL(googleAccountsRequest("next-page").url)
    expect(next.searchParams.get("pageToken")).toBe("next-page")
  })

  it("builds a paginated batchGetReviews request with canonical names", () => {
    const request = googleBatchReviewsRequest(
      "accounts/123",
      ["locations/456", "accounts/123/locations/789"],
      "next"
    )
    expect(request.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/123/locations:batchGetReviews"
    )
    expect(JSON.parse(String(request.init.body))).toEqual({
      locationNames: [
        "accounts/123/locations/456",
        "accounts/123/locations/789",
      ],
      pageSize: 50,
      pageToken: "next",
      orderBy: "updateTime desc",
    })
  })

  it("enforces Google's 50-location batch limit", () => {
    expect(() =>
      googleBatchReviewsRequest(
        "accounts/123",
        Array.from({ length: 51 }, (_, index) => `locations/${index}`)
      )
    ).toThrow(/1–50/)
  })

  it("uses the text-only updateReply contract", () => {
    const request = googleReplyRequest(
      "accounts/1/locations/2/reviews/3",
      "Thank you."
    )
    expect(request.init.method).toBe("PUT")
    expect(JSON.parse(String(request.init.body))).toEqual({
      comment: "Thank you.",
    })
  })

  it("subscribes only to review create and update notifications", () => {
    const request = googleNotificationSettingRequest(
      "accounts/123",
      "projects/example-project/topics/gbp-reviews"
    )
    expect(JSON.parse(String(request.init.body)).notificationTypes).toEqual([
      "NEW_REVIEW",
      "UPDATED_REVIEW",
    ])
  })
})
