"use client"

import Link from "next/link"
import {
  TriangleAlertIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  MessageSquareReplyIcon,
  StarIcon,
} from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import {
  buildWorkItems,
  totalOpenWork,
  type WorkItem,
} from "@/lib/home/work-queues"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

const HEADING_ID = "your-work-heading"

const ICONS: Record<string, typeof MessageSquareReplyIcon> = {
  needs_reply: MessageSquareReplyIcon,
  awaiting_approval: ClipboardCheckIcon,
  escalated: TriangleAlertIcon,
  unresolved_low: StarIcon,
}

function WorkCard({ item }: { item: WorkItem }) {
  const Icon = ICONS[item.id] ?? MessageSquareReplyIcon
  const hasWork = item.count > 0
  return (
    <Link
      href={item.href}
      prefetch={false}
      className={cn(
        "flex flex-col gap-3 rounded-(--nr-radius-card) border border-border bg-card p-4 shadow-(--nr-shadow-card) transition-colors duration-(--nr-duration-fast)",
        "hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
        hasWork ? "border-border" : "opacity-90"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-9 items-center justify-center rounded-(--nr-radius-control) bg-muted text-muted-foreground">
          <Icon aria-hidden className="size-4" />
        </span>
        <span
          className={cn(
            "text-page-title font-semibold tracking-tight tabular-nums",
            hasWork ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {formatNumber(item.count)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ui font-semibold">{item.label}</span>
        <span className="text-caption text-muted-foreground">
          {item.description}
        </span>
        <span className="text-caption text-muted-foreground">
          {item.window === "live" ? "Open now" : "Last 30 days"}
        </span>
      </div>
    </Link>
  )
}

function WorkQueue({
  byStatus,
  total,
  unresolvedComplaints,
  isPending,
}: {
  byStatus: Record<string, number>
  total: number
  unresolvedComplaints: number
  isPending?: boolean
}) {
  if (isPending) {
    return (
      <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
        <h2 id={HEADING_ID} className="text-title font-semibold tracking-tight">
          Your work
        </h2>
        <div
          aria-busy="true"
          className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4"
        >
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-32 rounded-(--nr-radius-card)" />
          ))}
        </div>
      </section>
    )
  }

  const items = buildWorkItems({ byStatus, total, unresolvedComplaints })
  const open = totalOpenWork(items)

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id={HEADING_ID} className="text-title font-semibold tracking-tight">
            Your work
          </h2>
          <p className="text-caption text-muted-foreground">
            Live inbox queues, plus low ratings from the last 30 days.
          </p>
        </div>
        {open === 0 ? (
          <p className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <CheckCircle2Icon aria-hidden className="size-3.5 text-success" />
            You’re caught up
          </p>
        ) : null}
      </div>
      <div className="grid gap-(--nr-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <WorkCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

export { WorkQueue }
