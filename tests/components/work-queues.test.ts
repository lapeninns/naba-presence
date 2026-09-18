import { describe, expect, it } from "vitest"

import {
  buildWorkItems,
  countForQueue,
  totalOpenWork,
} from "@/lib/home/work-queues"
import type { ReviewCounts } from "@/lib/contracts/reviews"

const counts: Pick<ReviewCounts, "byQueue"> = {
  byQueue: {
    needs_reply: 9,
    approval: 0,
    awaiting_my_approval: 4,
    awaiting_others: 2,
    publishing: 1,
    failed: 2,
    done: 11,
    all: 29,
  },
}

describe("countForQueue", () => {
  it("reads the server's own count for a queue", () => {
    // Home used to re-derive this by summing workflow statuses, so it agreed
    // with the inbox only until somebody changed what a queue means. Both now
    // read the same numbers, computed from the predicates the list filters by.
    expect(countForQueue(counts, "needs_reply")).toBe(9)
    expect(countForQueue(counts, "awaiting_my_approval")).toBe(4)
    expect(countForQueue(counts, "all")).toBe(29)
  })

  it("reads zero rather than throwing before the counts arrive", () => {
    expect(countForQueue(undefined, "needs_reply")).toBe(0)
  })
})

describe("buildWorkItems", () => {
  it("builds inbox deep links and labels windows", () => {
    const items = buildWorkItems({ counts, unresolvedComplaints: 7 })
    expect(items).toEqual([
      {
        id: "needs_reply",
        label: "Needs reply",
        description: "Open reviews waiting for a reply",
        count: 9,
        href: "/inbox?queue=needs_reply",
        window: "live",
      },
      {
        id: "awaiting_approval",
        label: "Awaiting approval",
        description: "Drafts waiting for a manager",
        count: 4,
        href: "/inbox?queue=awaiting_my_approval",
        window: "live",
      },
      {
        id: "unresolved_low",
        label: "Unresolved low ratings",
        description: "1–2 star reviews with no published reply",
        count: 7,
        href: "/inbox?rating=1,2&replyState=unreplied",
        window: "last_30_days",
      },
    ])
    expect(totalOpenWork(items)).toBe(9 + 4 + 7)
  })

  it("narrows every link to one client when scoped", () => {
    // A client-scoped Home has to send the operator to that client's inbox,
    // not to everything.
    const items = buildWorkItems({
      counts,
      unresolvedComplaints: 0,
      clientId: "c1",
    })
    for (const item of items) {
      expect(item.href).toContain("clientId=c1")
    }
  })
})
