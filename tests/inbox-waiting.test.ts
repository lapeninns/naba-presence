import { describe, expect, it } from "vitest"

import type { ReviewCounts } from "@/lib/contracts/reviews"
import { inboxWaiting, waitingPhrase } from "@/lib/inbox/waiting"

function counts(byQueue: Partial<ReviewCounts["byQueue"]>): ReviewCounts {
  return { total: 0, byStatus: {}, byQueue } as unknown as ReviewCounts
}

describe("inboxWaiting", () => {
  it("is undefined until counts arrive", () => {
    expect(inboxWaiting(undefined)).toBeUndefined()
  })

  it("sums reviews to reply to and replies awaiting this person's approval", () => {
    expect(
      inboxWaiting(counts({ needs_reply: 3, awaiting_my_approval: 2 }))
    ).toEqual({ needsReply: 3, awaitingMyApproval: 2, total: 5 })
  })

  it("never counts approvals that wait on someone else, or an older server's missing queue", () => {
    expect(
      inboxWaiting(counts({ needs_reply: 3, awaiting_others: 4, approval: 4 }))
    ).toEqual({ needsReply: 3, awaitingMyApproval: 0, total: 3 })
  })
})

describe("waitingPhrase", () => {
  it("keeps the old wording while only replies wait", () => {
    expect(waitingPhrase({ needsReply: 1, awaitingMyApproval: 0 })).toBe(
      "1 needs a reply"
    )
    expect(waitingPhrase({ needsReply: 2, awaitingMyApproval: 0 })).toBe(
      "2 need a reply"
    )
    expect(
      waitingPhrase({ needsReply: 1, awaitingMyApproval: 0 }, { reviews: true })
    ).toBe("1 review needs a reply")
    expect(
      waitingPhrase({ needsReply: 5, awaitingMyApproval: 0 }, { reviews: true })
    ).toBe("5 reviews need a reply")
  })

  it("names approvals alone and both together", () => {
    expect(waitingPhrase({ needsReply: 0, awaitingMyApproval: 2 })).toBe(
      "2 awaiting your approval"
    )
    expect(
      waitingPhrase({ needsReply: 0, awaitingMyApproval: 1 }, { reviews: true })
    ).toBe("1 review awaits your approval")
    expect(waitingPhrase({ needsReply: 1, awaitingMyApproval: 1 })).toBe(
      "2 need your attention: 1 to reply, 1 to approve"
    )
  })
})
