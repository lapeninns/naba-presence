"use client"

import { useId } from "react"

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
 * The five queue controls, above the review workspace.
 *
 * They replace the permanent left rail. A rail spent 240px of a 1280px screen
 * on six rows that change once an hour, and it pushed the reply — the thing the
 * operator is actually here for — into whatever was left. The same six rows fit
 * on one line above the panes, and the detail pane gets the width back.
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
}: {
  queue: ReviewQueue
  counts: ReviewCounts | undefined
  countsPending: boolean
  onQueueChange: (queue: VisibleQueue) => void
}) {
  const noteId = useId()
  const current = visibleQueue(queue)

  return (
    <nav
      aria-label="Review queues"
      aria-describedby={noteId}
      className="flex flex-wrap items-center gap-1 border-b border-line-subtle pb-2"
    >
      {VISIBLE_QUEUES.map((item) => {
        const count = counts?.byQueue?.[item] ?? 0
        const active = current === item
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
              "flex min-h-9 items-center justify-center gap-2 rounded-(--np-radius-control) border px-3 text-ui whitespace-nowrap focus-halo transition duration-(--np-duration-fast) ease-spring-snappy focus-visible:outline-none",
              active
                ? // A neutral fill and a real edge, not the accent tint:
                  // strong colour is reserved for the primary action and for
                  // exceptions that need attention.
                  "border-line bg-fill-secondary font-semibold text-ink"
                : "border-transparent text-ink-muted hover:bg-fill-tertiary hover:text-ink"
            )}
          >
            <span>{REVIEW_QUEUE_LABELS[item]}</span>
            {countsPending ? (
              // A skeleton, never a zero: "0" before the count lands tells the
              // operator there is nothing to do when there may be plenty.
              <Skeleton className="h-3 w-5" />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "text-caption tabular-nums",
                  // The one queue whose non-zero count is itself the exception.
                  item === "failed" && count > 0
                    ? "text-danger-ink"
                    : active
                      ? "text-ink"
                      : "text-ink-muted"
                )}
              >
                {count > 0 ? count : "–"}
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
