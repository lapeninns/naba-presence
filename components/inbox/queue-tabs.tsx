"use client"

import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { QUEUES, QUEUE_STATUS_MAP, type Queue } from "@/lib/inbox/url-state"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

// Short labels fit the narrow list pane; aria-label keeps the full name + count.
const QUEUE_LABELS: Record<Queue, { short: string; full: string }> = {
  all: { short: "All", full: "All reviews" },
  needs_reply: { short: "Needs reply", full: "Needs reply" },
  awaiting_approval: { short: "Approval", full: "Awaiting approval" },
  published: { short: "Published", full: "Published" },
}

function countFor(
  queue: Queue,
  total: number,
  byStatus: Record<string, number>
): number {
  const statuses = QUEUE_STATUS_MAP[queue]
  if (!statuses) return total
  return statuses.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0)
}

function QueueTabs({
  queue,
  total,
  byStatus,
  countsPending = false,
  onQueueChange,
}: {
  queue: Queue
  total: number
  byStatus: Record<string, number>
  /** Avoid flashing "0" on every tab while counts are still loading. */
  countsPending?: boolean
  onQueueChange: (queue: Queue) => void
}) {
  return (
    <Tabs
      value={queue}
      onValueChange={(value) => onQueueChange(value as Queue)}
      className="gap-0"
    >
      <TabsList
        aria-label="Review queues"
        className="gap-0.5 p-0.5"
      >
        {QUEUES.map((item) => {
          const count = countFor(item, total, byStatus)
          const selected = item === queue
          const labels = QUEUE_LABELS[item]
          // All + Needs reply stay put (the two ways into the queue). Other
          // tabs hide at zero so Approval/Escalated don't occupy the strip
          // when there is nothing there — unless that tab is the current
          // one, so a deep link to an empty queue is still visible.
          // While counts are loading, keep every tab so they don't pop in.
          const alwaysShown = item === "all" || item === "needs_reply"
          if (!countsPending && !alwaysShown && !selected && count === 0) {
            return null
          }
          return (
            <TabsTab
              key={item}
              value={item}
              aria-label={
                countsPending
                  ? `${labels.full}, loading count`
                  : `${labels.full}, ${count}`
              }
              className="gap-1 px-2 py-1"
            >
              <span>{labels.short}</span>
              {/* Selected tab sits on bg-background, so the chip uses the
                  accent tint (Google pale blue / dark tonal container) with
                  accent-foreground text — a measured pair (5.57:1 light,
                  9.82:1 dark). Unselected keeps the neutral muted-foreground
                  tint with explicit text-foreground (the inherited
                  muted-foreground on the tint pill measured 4.44:1, just
                  under AA). */}
              {countsPending ? (
                <Skeleton
                  aria-hidden
                  className="h-4 w-5 rounded-(--nr-radius-tag)"
                />
              ) : (
                <span
                  className={cn(
                    "rounded-(--nr-radius-tag) px-1.5 py-px text-caption tabular-nums",
                    selected
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted-foreground/15 text-foreground"
                  )}
                >
                  {formatNumber(count)}
                </span>
              )}
            </TabsTab>
          )
        })}
      </TabsList>
    </Tabs>
  )
}

export { QueueTabs }
