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
    capabilities: {
      canPublish: false,
      canEdit: true,
      canRequestApproval: true,
    },
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

describe("describeException: Google moderation", () => {
  const reply = (
    googleReplyState: string | null,
    publishStatus = "published"
  ) => ({
    id: "reply-1",
    body: "Thank you",
    publishStatus,
    googleReplyState,
    googlePolicyViolation: null,
    googleReplyUpdatedAt: null,
    lastErrorCode: null,
  })
  it("says Google is still reviewing a published reply", () => {
    const exception = describeException(
      review({ workflowStatus: "published", reply: reply("PENDING") }),
      submit,
      "connected"
    )
    expect(exception?.title).toBe("Google is reviewing this reply")
    expect(exception?.description).toContain(
      "don’t see it until Google approves it"
    )
  })
  it("shows nothing once Google has approved it", () => {
    expect(
      describeException(
        review({ workflowStatus: "published", reply: reply("APPROVED") }),
        submit,
        "connected"
      )?.title
    ).not.toBe("Google is reviewing this reply")
  })
})

describe("describeException: connection actions by role", () => {
  const failed = (lastErrorCode: string) =>
    review({
      workflowStatus: "failed",
      reply: {
        id: "reply-1",
        body: "Sorry",
        publishStatus: "failed",
        googleReplyState: null,
        googlePolicyViolation: null,
        googleReplyUpdatedAt: null,
        lastErrorCode,
      },
    })

  it("offers the connections link to owners and admins", () => {
    expect(
      describeException(
        failed("google_reconnect_required"),
        submit,
        "connected"
      )
    ).toMatchObject({ connectionLink: true })
    expect(describeException(review(), submit, "disconnected")).toMatchObject({
      connectionLink: true,
    })
  })

  it("keeps the explanation for everyone else, with no link and who to ask", () => {
    for (const exception of [
      describeException(
        failed("google_reconnect_required"),
        submit,
        "connected",
        false
      ),
      describeException(review(), submit, "disconnected", false),
    ]) {
      expect(exception?.connectionLink).toBe(false)
      expect(exception?.description).toMatch(
        /Ask an owner or admin to reconnect Google/
      )
    }
  })
})

// Plan D1 (R01b): the server's approval scope and two-person flag decide the
// approval wording; `canPublish` alone cannot tell the requester apart.
describe("describeException: two-person approval (R01b)", () => {
  const publisher = {
    canPublish: true,
    canEdit: true,
    canRequestApproval: false,
    requireTwoPersonApproval: true,
  }
  const approve = { kind: "approve" } as unknown as PrimaryAction

  it("tells the requester the reply waits on a second person", () => {
    const exception = describeException(
      review({
        workflowStatus: "awaiting_approval",
        capabilities: { ...publisher, approvalScope: "others" },
      }),
      approve,
      "connected"
    )
    expect(exception?.title).toBe("Waiting for another approver")
    expect(exception?.description).toContain("second person")
  })

  it("tells the second publisher the approval is theirs", () => {
    const exception = describeException(
      review({
        workflowStatus: "awaiting_approval",
        capabilities: { ...publisher, approvalScope: "me" },
      }),
      approve,
      "connected"
    )
    expect(exception?.title).toBe("Approval required")
    expect(exception?.description).toContain("waiting for your approval")
  })

  it("tells the draft's author someone else approves, and they may reject", () => {
    const exception = describeException(
      review({
        workflowStatus: "awaiting_approval",
        capabilities: { ...publisher, approvalScope: "me", canApprove: false },
      }),
      approve,
      "connected"
    )
    expect(exception?.title).toBe("Waiting for another approver")
    expect(exception?.description).toContain("You wrote this reply")
    expect(exception?.description).toContain("reject")
  })

  it("explains a publisher's submit under the two-person rule", () => {
    const exception = describeException(
      review({ capabilities: { ...publisher, approvalScope: null } }),
      submit,
      "connected"
    )
    expect(exception?.title).toBe("Approval required")
    expect(exception?.description).toContain("second person")
  })
})
