import { describe, expect, it } from "vitest"

import {
  buildWorkItems,
  countForQueue,
  totalOpenWork,
} from "@/lib/home/work-queues"
import { QUEUE_STATUS_MAP } from "@/lib/inbox/url-state"

const byStatus = {
  new: 2,
  drafted: 1,
  verified: 3,
  awaiting_approval: 4,
  publish_requested: 1,
  published: 10,
  rejected: 1,
  failed: 2,
}

describe("countForQueue", () => {
  it("matches Inbox QUEUE_STATUS_MAP for needs_reply", () => {
    const expected = QUEUE_STATUS_MAP.needs_reply!.reduce(
      (sum, status) => sum + (byStatus[status as keyof typeof byStatus] ?? 0),
      0
    )
    expect(countForQueue(byStatus, "needs_reply")).toBe(expected)
    expect(countForQueue(byStatus, "needs_reply")).toBe(2 + 1 + 3 + 2 + 1)
  })

  it("sums awaiting_approval from a single status", () => {
    expect(countForQueue(byStatus, "awaiting_approval")).toBe(4)
  })

  it("uses total for the all queue", () => {
    expect(countForQueue(byStatus, "all", 29)).toBe(29)
  })

  it("treats missing statuses as zero", () => {
    expect(countForQueue({}, "needs_reply")).toBe(0)
  })
})

describe("buildWorkItems", () => {
  it("builds inbox deep links and labels windows", () => {
    const items = buildWorkItems({
      byStatus,
      total: 29,
      unresolvedComplaints: 7,
    })
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
        href: "/inbox?queue=awaiting_approval",
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
})
