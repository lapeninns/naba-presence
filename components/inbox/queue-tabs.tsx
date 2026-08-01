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
            <span className="rounded-full bg-muted-foreground/15 px-1.5 text-caption tabular-nums">
              {formatNumber(countFor(item, total, byStatus))}
            </span>
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  )
}

export { QueueTabs }
