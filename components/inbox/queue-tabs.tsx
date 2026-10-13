"use client"

import { useEffect, useId, useRef } from "react"

import {
  segmentedItemClassName,
  segmentedThumbClassName,
  segmentedTrackClassName,
  useSegmentedOverflow,
} from "@/components/ui/segmented-control"
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
import { useWorkspaceMode } from "@/lib/workspace/mode"

/**
 * How far inside the strip's edge the current queue is kept: the width of
 * the track's edge fade, so the queue never sits half-faded.
 */
const EDGE_PX = 24

/**
 * Scrolls the strip, and only the strip, until `item` sits clear of the
 * faded edges. `scrollIntoView` would also scroll the page to the toolbar,
 * which is not what landing on `?queue=failed` should do. The same sum as
 * the segmented control's own reveal: the track is `relative`, so
 * `offsetLeft` is measured from it.
 */
function revealInStrip(strip: HTMLElement, item: HTMLElement) {
  if (strip.scrollWidth <= strip.clientWidth) return
  const start = item.offsetLeft
  const end = start + item.offsetWidth
  if (start - EDGE_PX < strip.scrollLeft) {
    strip.scrollLeft = Math.max(0, start - EDGE_PX)
  } else if (end + EDGE_PX > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = end + EDGE_PX - strip.clientWidth
  }
}

/**
 * The five queues as one strip in the inbox toolbar: the segmented control's
 * track and segments (components/ui/segmented-control.tsx), with the current
 * queue on the raised white thumb and a non-zero Failed count in the danger
 * ink, because that number is itself the exception.
 *
 * The OBJECT is the segmented control; the SEMANTICS are navigation, which
 * is none of the control's three modes. Each queue is a guarded URL change
 * (a dirty reply asks first, and a new page of rows is fetched), so the
 * strip stays a `nav` labelled "Review queues" — the landmark screen-reader
 * users jump to — of plain buttons with `aria-current`. Tabs would select on
 * every arrow press, and an arrow that throws a discard prompt or a fetch is
 * not a way to look along a row. Hence the exported recipes rather than
 * `<SegmentedControl>`, as its own comment intends for this case.
 *
 * On a phone the strip is wider than the screen, so it scrolls sideways
 * rather than wrapping or cutting a label: the edge that hides a queue
 * fades, and the current queue is scrolled into the strip on arrival (a
 * link to Failed lands with Failed in sight) and whenever it changes. The
 * track is the control height — 44px on touch, every segment's hit area
 * reaching its full height — and 36px at the desk.
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
  const business = useWorkspaceMode() === "business"
  const current = visibleQueue(queue)
  const stripRef = useRef<HTMLDivElement>(null)
  useSegmentedOverflow(stripRef)

  // The counts landing changes every segment's width, so the current one is
  // revealed again then as well as when it changes.
  useEffect(() => {
    const strip = stripRef.current
    const item = strip?.querySelector<HTMLElement>(
      `[data-slot="queue-tab"][data-queue="${current}"]`
    )
    if (strip && item) revealInStrip(strip, item)
  }, [current, countsPending])

  return (
    <nav
      aria-label="Review queues"
      aria-describedby={noteId}
      className={cn("flex max-w-full min-w-0", className)}
    >
      <div
        ref={stripRef}
        data-slot="queue-strip"
        className={segmentedTrackClassName}
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
              // Spelled out rather than left to the two adjacent elements,
              // which have no whitespace between them and would announce as
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
                segmentedItemClassName,
                active && [segmentedThumbClassName, "font-semibold text-ink"]
              )}
            >
              <span>{REVIEW_QUEUE_LABELS[item]}</span>
              {countsPending ? (
                // A skeleton, never a zero: "0" before the count lands tells
                // the operator there is nothing to do when there may be plenty.
                <Skeleton className="h-3 w-4" />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "font-mono text-count tabular-nums",
                    alert
                      ? "font-semibold text-danger-ink"
                      : active
                        ? "text-ink-secondary"
                        : "text-ink-muted"
                  )}
                >
                  {count > 0 ? formatNumber(count) : "–"}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* Counts come from GET /api/reviews/counts, which is scoped by client
          but knows nothing about the rating, search, age or assignee filters
          the list applies. Saying so is cheaper than a number that quietly
          disagrees with the rows underneath it. */}
      <span id={noteId} className="sr-only">
        {business
          ? "Counts cover every review in each queue."
          : "Counts cover every review in each queue for the current client scope."}{" "}
        The list below also applies your filters, so it can show fewer.
      </span>
    </nav>
  )
}

export { QueueTabs }
