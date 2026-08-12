import {
  QUEUE_STATUS_MAP,
  type Queue,
} from "@/lib/inbox/url-state"

export type WorkWindow = "live" | "last_30_days"

export type WorkItem = {
  id: string
  label: string
  description: string
  count: number
  href: string
  window: WorkWindow
}

/** Same math as Inbox queue tabs — keeps Overview and Inbox from drifting. */
export function countForQueue(
  byStatus: Record<string, number>,
  queue: Queue,
  total = 0
): number {
  const statuses = QUEUE_STATUS_MAP[queue]
  if (!statuses) return total
  return statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0)
}

/**
 * Actionable work for Overview. Live counts come from `/api/reviews/counts`
 * via inbox queues; unresolved low ratings come from the 30-day analytics
 * summary so the window is labeled explicitly.
 */
export function buildWorkItems(input: {
  byStatus: Record<string, number>
  total: number
  unresolvedComplaints: number
}): WorkItem[] {
  return [
    {
      id: "needs_reply",
      label: "Needs reply",
      description: "Open reviews waiting for a reply",
      count: countForQueue(input.byStatus, "needs_reply", input.total),
      href: "/inbox?queue=needs_reply",
      window: "live",
    },
    {
      id: "awaiting_approval",
      label: "Awaiting approval",
      description: "Drafts waiting for a manager",
      count: countForQueue(input.byStatus, "awaiting_approval", input.total),
      href: "/inbox?queue=awaiting_approval",
      window: "live",
    },
    {
      id: "escalated",
      label: "Escalated",
      description: "Reviews flagged for escalation",
      count: countForQueue(input.byStatus, "escalated", input.total),
      href: "/inbox?queue=escalated",
      window: "live",
    },
    {
      id: "unresolved_low",
      label: "Unresolved low ratings",
      description: "1–2 star reviews with no published reply",
      count: input.unresolvedComplaints,
      href: "/inbox?rating=1,2&replyState=unreplied",
      window: "last_30_days",
    },
  ]
}

export function totalOpenWork(items: WorkItem[]): number {
  return items.reduce((sum, item) => sum + item.count, 0)
}
