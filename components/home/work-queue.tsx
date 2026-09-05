"use client"

import { CheckCircle2Icon, ChevronRightIcon } from "lucide-react"
import Link from "next/link"

import {
  HomeSection,
  ListRowsSkeleton,
  listCardClassName,
  listRowClassName,
} from "@/components/home/home-section"
import { StatusPill } from "@/components/ui/status-pill"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import {
  buildWorkItems,
  totalOpenWork,
  type WorkItem,
} from "@/lib/home/work-queues"
import { formatNumber } from "@/lib/format"
import type { StatusTone } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

const HEADING_ID = "your-work-heading"

// The tone a queue takes once it has something in it. An empty queue is
// neutral whatever its kind: the dot says "there is work here", not "this
// queue exists".
const TONES: Record<string, StatusTone> = {
  needs_reply: "attention",
  awaiting_approval: "pending",
  unresolved_low: "at-risk",
}

function WorkRow({ item }: { item: WorkItem }) {
  const hasWork = item.count > 0
  return (
    <li>
      <Link href={item.href} prefetch={false} className={listRowClassName}>
        <StatusPill
          variant="dot"
          tone={hasWork ? (TONES[item.id] ?? "neutral") : "neutral"}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-medium text-ink">
            {item.label}
          </span>
          <span className="truncate text-caption text-ink-muted">
            {item.description}
            {" · "}
            {item.window === "live" ? "Open now" : "Last 30 days"}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 text-body font-semibold tabular-nums",
            hasWork ? "text-ink" : "text-ink-muted"
          )}
        >
          {formatNumber(item.count)}
        </span>
        <ChevronRightIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-ink-faint"
        />
      </Link>
    </li>
  )
}

function WorkQueue({
  counts,
  unresolvedComplaints,
  isPending,
}: {
  // The whole counts payload, not a re-derivation from workflow statuses:
  // Home and the inbox rail now read the same server-computed queue numbers,
  // so they cannot disagree about what "needs reply" means.
  counts: Pick<ReviewCounts, "byQueue"> | undefined
  unresolvedComplaints: number
  isPending?: boolean
}) {
  if (isPending) {
    return (
      <HomeSection
        id={HEADING_ID}
        title="Your work"
        description="Live inbox queues, plus low ratings from the last 30 days."
      >
        <ListRowsSkeleton rows={3} />
      </HomeSection>
    )
  }

  const items = buildWorkItems({ counts, unresolvedComplaints })
  const open = totalOpenWork(items)

  return (
    <HomeSection
      id={HEADING_ID}
      title="Your work"
      description="Live inbox queues, plus low ratings from the last 30 days."
      aside={
        open === 0 ? (
          <p className="inline-flex items-center gap-1.5 text-caption text-ink-muted">
            <CheckCircle2Icon
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 text-success-ink"
            />
            You’re caught up
          </p>
        ) : null
      }
    >
      <ul className={listCardClassName}>
        {items.map((item) => (
          <WorkRow key={item.id} item={item} />
        ))}
      </ul>
    </HomeSection>
  )
}

export { WorkQueue }
