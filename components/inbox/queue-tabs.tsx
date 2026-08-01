"use client"

import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
import { QUEUES, QUEUE_STATUS_MAP, type Queue } from "@/lib/inbox/url-state"
import { formatNumber } from "@/lib/format"

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
      <TabsList>
        {QUEUES.map((item) => (
          <TabsTab
            key={item}
            value={item}
            aria-label={`${QUEUE_LABELS[item]}, ${countFor(item, total, byStatus)}`}
          >
            <span>{QUEUE_LABELS[item]}</span>
            {/* Explicit text-foreground (not the inherited muted-foreground):
                a low-opacity muted-foreground tint pill blended against the
                unselected tab's muted background falls just under the 4.5:1
                AA contrast ratio (measured 4.44:1 light / 3.99:1 dark) —
                text-foreground stays legible regardless of selection state. */}
            <span className="rounded-full bg-muted-foreground/15 px-1.5 text-caption text-foreground tabular-nums">
              {formatNumber(countFor(item, total, byStatus))}
            </span>
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  )
}

export { QueueTabs }
