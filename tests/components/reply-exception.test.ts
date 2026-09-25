import { describe, expect, it } from "vitest"

import { describeException } from "@/components/inbox/detail/reply-exception"
import type { ReviewDetail } from "@/lib/contracts/reviews"
import type { PrimaryAction } from "@/lib/inbox/reply-state"

type Review = ReviewDetail["review"]

function review(overrides: Partial<Review> = {}): Review {
  return {
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
    workflowStatus: "drafted",
    locationId: "loc-1",
    locationName: "Riverside",
    timezone: "Europe/London",
    verified: true,
    media: [],
    drafts: [],
    reply: null,
    timeline: [],
    capabilities: { canPublish: false, canEdit: true, canRequestApproval: true },
    latestVerification: null,
    ...overrides,
  }
}

const submit = { kind: "submit" } as unknown as PrimaryAction

describe("describeException: rejected by the approver", () => {
  // The reject dialog asks the approver for a reason; it used to be stored
  // and never shown, so the author got the draft back with no idea why.
  it("shows the approver's note to the author", () => {
    const exception = describeException(
      review({
        lastRejection: {
          note: "Please mention the spa.",
          decidedByName: "Priya",
          decidedAt: "2026-09-02T09:00:00.000Z",
        },
      }),
      submit,
      "connected"
    )
    expect(exception?.title).toBe("Sent back by the approver")
    expect(exception?.description).toContain("Priya")
    expect(exception?.description).toContain("Please mention the spa.")
  })

  it("says so when the approver left no note", () => {
    const exception = describeException(
      review({
        lastRejection: {
          note: null,
          decidedByName: null,
          decidedAt: "2026-09-02T09:00:00.000Z",
        },
      }),
      submit,
      "connected"
    )
    expect(exception?.description).toContain("without a note")
  })

  it("falls back to the approval notice when nothing was rejected", () => {
    const exception = describeException(
      review({ lastRejection: null }),
      submit,
      "connected"
    )
    expect(exception?.title).toBe("Approval required")
  })
})
