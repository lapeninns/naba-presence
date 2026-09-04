import type { ReviewCounts, ReviewQueue } from "@/lib/contracts/reviews"

export type WorkWindow = "live" | "last_30_days"

export type WorkItem = {
  id: string
  label: string
  description: string
  count: number
  href: string
  window: WorkWindow
}

/**
 * The queue's own count, straight from the server.
 *
 * Overview used to re-derive this by summing workflow statuses, which meant
 * Home and the inbox agreed only for as long as nobody changed what a queue
 * means. Both now read the same `byQueue` numbers, computed once from the
 * predicates the list query filters by.
 */
export function countForQueue(
  counts: Pick<ReviewCounts, "byQueue"> | undefined,
  queue: ReviewQueue
): number {
  return counts?.byQueue?.[queue] ?? 0
}

/**
 * Actionable work for Overview. Live counts come from `/api/reviews/counts`
 * via inbox queues; unresolved low ratings come from the 30-day analytics
 * summary so the window is labeled explicitly.
 */
export function buildWorkItems(input: {
  counts: Pick<ReviewCounts, "byQueue"> | undefined
  unresolvedComplaints: number
  /** Narrows every link to one client, for a client-scoped Home. */
  clientId?: string
}): WorkItem[] {
  const scope = input.clientId ? `&clientId=${input.clientId}` : ""
  return [
    {
      id: "needs_reply",
      label: "Needs reply",
      description: "Open reviews waiting for a reply",
      count: countForQueue(input.counts, "needs_reply"),
      href: `/inbox?queue=needs_reply${scope}`,
      window: "live",
    },
    {
      id: "awaiting_approval",
      label: "Awaiting approval",
      description: "Drafts waiting for a manager",
      count: countForQueue(input.counts, "awaiting_my_approval"),
      href: `/inbox?queue=awaiting_my_approval${scope}`,
      window: "live",
    },
    {
      id: "unresolved_low",
      label: "Unresolved low ratings",
      description: "1–2 star reviews with no published reply",
      count: input.unresolvedComplaints,
      href: `/inbox?rating=1,2&replyState=unreplied${scope}`,
      window: "last_30_days",
    },
  ]
}

export function totalOpenWork(items: WorkItem[]): number {
  return items.reduce((sum, item) => sum + item.count, 0)
}
