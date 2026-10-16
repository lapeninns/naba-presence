"use client"

import { useEffect, useId, useRef } from "react"

import { ChipRow } from "@/components/ui/chip"
import { Skeleton } from "@/components/ui/skeleton"
import { TabCount, textTabItemClassName } from "@/components/ui/tabs"
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
 * the row's edge fade (`ChipRow`'s 2.5rem mask), so the queue never sits
 * half-faded.
 */
const EDGE_PX = 40

/**
 * Scrolls the strip, and only the strip, until `item` sits clear of the
 * faded edges. `scrollIntoView` would also scroll the page to the toolbar,
 * which is not what landing on `?queue=failed` should do. The row's own
 * reveal (`ChipRow`) follows `aria-current="page"`; a queue is a button
 * with `aria-current="true"`, so the strip keeps this one. The row is
 * `relative`, so `offsetLeft` is measured from it.
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
 * The five queues as one strip of text tabs in the inbox toolbar, with a
 * non-zero Failed count in the danger ink, because that number is itself
 * the exception.
 *
 * Each number is drawn once. Needs reply is the "Inbox N" title's count, and
 * the current queue's is the list header's ("4 reviews"), so neither tab
 * repeats it; the other queues show theirs, and a queue with nothing in it
 * shows no figure (`TabCount`'s zero rule, said aloud in its name). The
 * counts cover every review in the queue and know nothing of the filters, so
 * while `filtered` is on they are not drawn rather than disagreeing with the
 * rows beneath them. The one exception is a non-zero Failed count, which stays.
 *
 * The strip is the primitive chip row (one row that scrolls sideways with
 * faded edges); the SEMANTICS are navigation, not `TextTabs`' links nor a
 * tablist. Each queue is a guarded URL change
 * (a dirty reply asks first, and a new page of rows is fetched), so the
 * strip stays a `nav` labelled "Review queues" — the landmark screen-reader
 * users jump to — of plain buttons with `aria-current`. Tabs would select on
 * every arrow press, and an arrow that throws a discard prompt or a fetch is
 * not a way to look along a row; a link would skip the dirty-reply guard.
 * Hence the exported text-tab recipe on buttons rather than `<TextTabs>`.
 *
 * On a phone the strip is wider than the screen, so it scrolls sideways
 * rather than wrapping or cutting a label: the edge that hides a queue
 * fades, and the current queue is scrolled into the strip on arrival (a
 * link to Failed lands with Failed in sight) and whenever it changes.
 */
function QueueTabs({
  queue,
  counts,
  countsPending,
  filtered = false,
  onQueueChange,
  className,
}: {
  queue: ReviewQueue
  counts: ReviewCounts | undefined
  countsPending: boolean
  /** A filter narrows the list, so the queue counts would not match it. */
  filtered?: boolean
  onQueueChange: (queue: VisibleQueue) => void
  className?: string
}) {
  const noteId = useId()
  const business = useWorkspaceMode() === "business"
  const current = visibleQueue(queue)
  const stripRef = useRef<HTMLDivElement>(null)

  // The counts landing changes every tab's width, so the current one is
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
      aria-describedby={filtered ? undefined : noteId}
      className={cn("flex max-w-full min-w-0", className)}
    >
      <ChipRow ref={stripRef} data-slot="queue-strip" className="gap-0.5">
        {VISIBLE_QUEUES.map((item) => {
          const count = counts?.byQueue?.[item] ?? 0
          const active = current === item
          const alert = item === "failed" && count > 0
          // A filter hides the figures, but not a non-zero Failed count: it is
          // the exception (see above), and an operator should never lose sight
          // of a failure behind a filter. The current queue and Needs reply
          // still carry none.
          const figure =
            !active && item !== "needs_reply" && (!filtered || alert)
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
                !figure || countsPending
                  ? null
                  : `${count} ${count === 1 ? "review" : "reviews"}`,
              ]
                .filter(Boolean)
                .join(", ")}
              // The primitive's text tab (Notion Mail's label tabs): 600 ink
              // with a 2px underline when current, which it draws for a
              // button's `aria-current="true"` as for a link's "page", and
              // at least 44px wide on touch.
              className={textTabItemClassName}
            >
              <span>{REVIEW_QUEUE_LABELS[item]}</span>
              {!figure ? null : countsPending ? (
                // A skeleton, never a zero: "0" before the count lands tells
                // the operator there is nothing to do when there may be plenty.
                <Skeleton className="h-3 w-4" />
              ) : (
                <TabCount
                  aria-hidden
                  className={cn(alert && "font-semibold text-danger-ink")}
                >
                  {formatNumber(count)}
                </TabCount>
              )}
            </button>
          )
        })}
      </ChipRow>
      {/* Counts come from GET /api/reviews/counts, which is scoped by client
          but knows nothing about the rating, search, age or assignee filters
          the list applies, so they are left off while any is on (see
          `filtered`) and this says what they cover the rest of the time. */}
      {filtered ? null : (
        <span id={noteId} className="sr-only">
          {business
            ? "Counts cover every review in each queue."
            : "Counts cover every review in each queue for the current client scope."}
        </span>
      )}
    </nav>
  )
}

export { QueueTabs }
