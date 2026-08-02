"use client"

import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { QUEUES, QUEUE_STATUS_MAP, type Queue } from "@/lib/inbox/url-state"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

const QUEUE_LABELS: Record<Queue, string> = {
  all: "All reviews",
  needs_reply: "Needs reply",
  awaiting_approval: "Awaiting approval",
  escalated: "Escalated",
  published: "Published",
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
  onQueueChange,
}: {
  queue: Queue
  total: number
  byStatus: Record<string, number>
  onQueueChange: (queue: Queue) => void
}) {
  return (
    <Tabs
      value={queue}
      onValueChange={(value) => onQueueChange(value as Queue)}
    >
      <TabsList aria-label="Review queues">
        {QUEUES.map((item) => {
          const count = countFor(item, total, byStatus)
          const selected = item === queue
          return (
            <TabsTab
              key={item}
              value={item}
              aria-label={`${QUEUE_LABELS[item]}, ${count}`}
            >
              <span>{QUEUE_LABELS[item]}</span>
              {/* Selected tab sits on bg-background, so the chip uses the
                  accent tint (Google pale blue / dark tonal container) with
                  accent-foreground text — a measured pair (5.57:1 light,
                  9.82:1 dark). Unselected keeps the neutral muted-foreground
                  tint with explicit text-foreground (the inherited
                  muted-foreground on the tint pill measured 4.44:1, just
                  under AA). */}
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
            </TabsTab>
          )
        })}
      </TabsList>
    </Tabs>
  )
}

export { QueueTabs }
