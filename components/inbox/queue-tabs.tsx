"use client"

import { useId } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { formatNumber } from "@/lib/format"
import {
  REVIEW_QUEUE_LABELS,
  type ReviewCounts,
  type ReviewQueue,
} from "@/lib/contracts/reviews"
import {
  VISIBLE_QUEUES,
  visibleQueue,
  type VisibleQueue,
} from "@/lib/inbox/url-state"
import { cn } from "@/lib/utils"

/**
 * The five queues as one segmented track in the inbox toolbar (reference
 * `.tabs`).
 *
 * The current queue fills with ink; the accent stays reserved for the
 * primary action. Each count sits beside its label in mono, and a non-zero
 * Failed count is drawn in the danger ink because that number is itself the
 * exception. The track scrolls sideways rather than wrapping on a phone, with
 * the cut segment saying there is more.
 *
 * Still a `nav` labelled "Review queues": these are the inbox's primary
 * navigation wherever they are drawn, and the landmark is what screen-reader
 * users jump to.
 */
function QueueTabs({
  queue,
  counts,
  countsPending,
  onQueueChange,
  className,
}: {
  queue: ReviewQueue
  counts: ReviewCounts | undefined
  countsPending: boolean
  onQueueChange: (queue: VisibleQueue) => void
  className?: string
}) {
  const noteId = useId()
  const current = visibleQueue(queue)

  return (
    <nav
      aria-label="Review queues"
      aria-describedby={noteId}
      className={cn(
        "flex max-w-full min-w-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-[10px] border border-line bg-surface-sunken p-[3px] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {VISIBLE_QUEUES.map((item) => {
        const count = counts?.byQueue?.[item] ?? 0
        const active = current === item
        const alert = item === "failed" && count > 0
        return (
          <button
            key={item}
            type="button"
            data-slot="queue-tab"
            data-queue={item}
            aria-current={active ? "true" : undefined}
            onClick={() => onQueueChange(item)}
            // Spelled out rather than left to the two adjacent elements, which
            // have no whitespace between them and would announce as
            // "Needs reply12".
            aria-label={[
              REVIEW_QUEUE_LABELS[item],
              countsPending
                ? null
                : `${count} ${count === 1 ? "review" : "reviews"}`,
            ]
              .filter(Boolean)
              .join(", ")}
            className={cn(
              "inline-flex min-h-[30px] shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 text-ui whitespace-nowrap focus-halo transition-[background-color,color] duration-(--np-duration-fast) ease-out-strong focus-visible:outline-none max-md:min-h-[38px] pointer-coarse:min-h-[38px]",
              active
                ? "bg-ink font-semibold text-canvas"
                : "text-ink-secondary hover:bg-fill hover:text-ink"
            )}
          >
            <span>{REVIEW_QUEUE_LABELS[item]}</span>
            {countsPending ? (
              // A skeleton, never a zero: "0" before the count lands tells the
              // operator there is nothing to do when there may be plenty.
              <Skeleton className={cn("h-3 w-4", active && "bg-canvas/30")} />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "font-mono text-[11.5px] tabular-nums",
                  active
                    ? "text-canvas/80"
                    : alert
                      ? "font-semibold text-danger-ink"
                      : "text-ink-muted"
                )}
              >
                {count > 0 ? formatNumber(count) : "–"}
              </span>
            )}
          </button>
        )
      })}
      {/* Counts come from GET /api/reviews/counts, which is scoped by client
          but knows nothing about the rating, search, age or assignee filters
          the list applies. Saying so is cheaper than a number that quietly
          disagrees with the rows underneath it. */}
      <span id={noteId} className="sr-only">
        Counts cover every review in each queue for the current client scope.
        The list below also applies your filters, so it can show fewer.
      </span>
    </nav>
  )
}

export { QueueTabs }
