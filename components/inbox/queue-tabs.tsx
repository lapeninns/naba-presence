"use client"

import { useId } from "react"

import { ChipCount, chipClassName } from "@/components/ui/chip"
import { Skeleton } from "@/components/ui/skeleton"
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
 * The five queues as a row of chips above the filters (reference `#queues`).
 *
 * The current queue fills with ink, like a pressed chip; the accent stays
 * reserved for the primary action. Each count sits inside its chip in mono,
 * and a non-zero Failed count is drawn in the danger ink because that number
 * is itself the exception. The row scrolls sideways rather than wrapping on
 * a phone, with the cut chip saying there is more.
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
        "-m-0.5 flex min-w-0 [scrollbar-width:none] items-center gap-2 overflow-x-auto p-0.5 [&::-webkit-scrollbar]:hidden",
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
            className={chipClassName({ pressed: active })}
          >
            <span>{REVIEW_QUEUE_LABELS[item]}</span>
            {countsPending ? (
              // A skeleton, never a zero: "0" before the count lands tells the
              // operator there is nothing to do when there may be plenty.
              <Skeleton className={cn("h-3 w-4", active && "bg-canvas/30")} />
            ) : (
              <ChipCount
                aria-hidden
                tone={alert && !active ? "alert" : "default"}
                className={cn(active && "text-canvas/80")}
              >
                {count > 0 ? count : "–"}
              </ChipCount>
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
