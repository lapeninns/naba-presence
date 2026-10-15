import { describe, expect, it } from "vitest"

import { reviewDetailSchema } from "@/lib/contracts/reviews"

/**
 * Plan D1 (R01b): the review detail carries the organisation's two-person
 * flag and a server-computed `approvalScope` inside `capabilities`. The
 * contract must accept both, refuse anything else for the scope, and still
 * parse a payload from an older server that sends neither.
 */

function payload(capabilities: Record<string, unknown>) {
  return {
    review: {
      id: "rev-1",
      reviewerDisplayName: "Sam",
      reviewerIsAnonymous: false,
      reviewerProfilePhotoUrl: null,
      rating: 2,
      text: "Cold food",
      detectedLanguageCode: "en",
      languageConfidence: 0.9,
      createTime: "2026-09-01T10:00:00.000Z",
      updateTime: "2026-09-01T10:00:00.000Z",
      hasMedia: false,
      workflowStatus: "awaiting_approval",
      locationId: "loc-1",
      locationName: "Riverside",
      timezone: "Europe/London",
      verified: true,
      media: [],
      drafts: [],
      reply: null,
      timeline: [],
      capabilities: {
        canPublish: true,
        canEdit: true,
        canRequestApproval: false,
        ...capabilities,
      },
      latestVerification: null,
    },
  }
}

describe("review detail approval fields (R01b)", () => {
  it.each(["me", "others", null] as const)(
    "carries approvalScope %s with the two-person flag",
    (approvalScope) => {
      const { review } = reviewDetailSchema.parse(
        payload({ requireTwoPersonApproval: true, approvalScope })
      )
      expect(review.capabilities.requireTwoPersonApproval).toBe(true)
      expect(review.capabilities.approvalScope).toBe(approvalScope)
    }
  )

  it("still parses a payload from a server that sends neither field", () => {
    const { review } = reviewDetailSchema.parse(payload({}))
    expect(review.capabilities.requireTwoPersonApproval).toBeUndefined()
    expect(review.capabilities.approvalScope).toBeUndefined()
  })

  it("refuses a scope the server never sends", () => {
    expect(
      reviewDetailSchema.safeParse(payload({ approvalScope: "unknown" }))
        .success
    ).toBe(false)
    expect(
      reviewDetailSchema.safeParse(
        payload({ requireTwoPersonApproval: "yes" })
      ).success
    ).toBe(false)
  })
})
