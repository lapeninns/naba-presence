import { PageFrame } from "@/components/app-shell/page-frame"
import { ReviewRowsSkeleton } from "@/components/inbox/review-list"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { INBOX_SPLIT_STYLE } from "@/lib/inbox/layout"

/**
 * The workspace in outline while the route loads, in the places the real
 * parts take (components/inbox/inbox-toolbar.tsx, list-header.tsx,
 * review-list.tsx, inbox-view.tsx) and with their classes: the one white
 * surface, the controls' padding, a single hairline above the split, the
 * list's quiet head band and avatar-led rows at their real heights. On a
 * phone the toolbar is three rows — the title and the actions, search beside
 * Filters, then the queue strip — above the list, edge to edge. From md the
 * title, search and actions share a row, with the queues and Filters under
 * it; from lg the review sits beside the list.
 *
 * It cannot know whether the URL opens a review, so it draws the list (what
 * most loads show). The page that replaces it is new content in place of the
 * outline, not the outline moving, and inside the page nothing changes
 * layout after hydration: a phone opened on `?selected=` is served the
 * review straight away (inbox-view.tsx keys the layout on `data-view`).
 * Says it is loading in words, not only in grey blocks.
 */
export default function InboxLoading() {
  return (
    <PageFrame
      width="workspace"
      className="min-h-0 flex-1 gap-3 pt-4 max-md:px-4 max-md:pt-3 md:pt-4"
    >
      <div className="flex min-h-0 flex-1 flex-col bg-surface">
        <div className="flex shrink-0 flex-col gap-3 pt-2 pb-4 md:px-5 md:pt-5">
          <div className="flex shrink-0 flex-col gap-3 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-2 max-md:gap-y-2.5">
            <div className="flex min-w-0 items-center gap-3 max-md:contents">
              <div className="flex min-w-0 flex-1 items-baseline gap-3 max-md:col-start-1 max-md:row-start-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h1 className="font-display text-section font-semibold text-ink md:text-page-title">
                    Inbox
                  </h1>
                  {/* The needs-reply count after the title, pending. */}
                  <Skeleton aria-hidden className="h-5 w-8 self-center" />
                </div>
              </div>
              <Skeleton
                aria-hidden
                className="h-(--np-field-h) rounded-(--np-radius-pill) max-md:col-start-1 max-md:row-start-2 md:w-56 lg:w-72"
              />
              <div
                aria-hidden
                className="flex shrink-0 items-center justify-end gap-2 max-md:col-start-2 max-md:row-start-1"
              >
                <Skeleton className="size-(--np-control-h)" />
              </div>
            </div>
            <div
              aria-hidden
              className="flex min-w-0 items-center gap-3 max-md:contents"
            >
              <div className="flex min-w-0 gap-2 overflow-hidden max-md:col-span-2 max-md:row-start-3">
                {[0, 1, 2, 3, 4].map((index) => (
                  <Skeleton
                    key={index}
                    className="h-(--np-touch) w-24 shrink-0 rounded-(--np-radius-control) desk:h-(--np-control-h)"
                  />
                ))}
              </div>
              <div className="flex flex-1 justify-end max-md:col-start-2 max-md:row-start-2">
                <Skeleton className="size-(--np-touch) rounded-(--np-radius-pill) desk:size-(--np-control-h)" />
              </div>
            </div>
          </div>
        </div>

        <div
          role="status"
          aria-busy="true"
          style={INBOX_SPLIT_STYLE}
          className="grid flex-1 grid-cols-1 border-t border-line lg:grid-cols-[var(--inbox-list-w)_minmax(0,1fr)]"
        >
          <div
            className="flex min-h-0 flex-col overflow-hidden bg-surface max-md:-mx-4 lg:border-r lg:border-line"
            aria-hidden
          >
            <div className="flex min-h-11 items-center gap-3 border-b border-line-subtle px-(--np-page-pad-x)">
              <Skeleton className="h-3 w-20" />
            </div>
            <ReviewRowsSkeleton />
          </div>
          <div className="hidden min-h-0 items-center justify-center bg-surface lg:flex">
            <p className="flex items-center gap-2 text-ui text-ink-muted">
              <Spinner decorative size="sm" />
              Loading reviews
            </p>
          </div>
          <p className="sr-only lg:hidden">Loading reviews</p>
        </div>
      </div>
    </PageFrame>
  )
}
