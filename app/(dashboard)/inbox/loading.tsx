import { PageFrame } from "@/components/app-shell/page-frame"
import { ReviewRowsSkeleton } from "@/components/inbox/review-list"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ViewHeader } from "@/components/ui/view-header"
import { INBOX_SPLIT_STYLE } from "@/lib/inbox/layout"

/**
 * The workspace in outline while the route loads, in the places the real
 * parts take (components/inbox/inbox-toolbar.tsx, list-header.tsx,
 * review-list.tsx, inbox-view.tsx) and with their classes: the one white
 * surface, the controls' padding, a single hairline above the split, the
 * list's quiet head band and avatar-led rows at their real heights. The band
 * is three rows at every width — the header (title, count, actions), the
 * search pill beside the Filters circle, then the queue strip — and from lg
 * the review sits beside the list.
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
        <div className="flex shrink-0 flex-col gap-3 pt-2 pb-4 max-md:-mx-4 max-md:px-4 md:px-5 md:pt-5">
          {/* The band (inbox-toolbar.tsx) at every width: ViewHeader, then
              the Toolbar row (search pill + Filters circle), then the queue
              strip. */}
          <div className="flex shrink-0 flex-col gap-3">
            <ViewHeader
              title="Inbox"
              count={
                <Skeleton
                  aria-hidden
                  className="inline-block h-5 w-8 align-middle"
                />
              }
              actions={
                <Skeleton aria-hidden className="size-(--np-control-h)" />
              }
            />
            <div aria-hidden className="flex min-w-0 items-center gap-2">
              <Skeleton className="h-(--np-touch) min-w-0 flex-1 basis-48 rounded-(--np-radius-pill) desk:h-(--np-control-h)" />
              <Skeleton className="size-(--np-touch) shrink-0 rounded-(--np-radius-pill) desk:size-(--np-control-h)" />
            </div>
            <div aria-hidden className="flex min-w-0 gap-2 overflow-hidden">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton
                  key={index}
                  className="h-(--np-touch) w-24 shrink-0 rounded-(--np-radius-control) desk:h-(--np-control-h)"
                />
              ))}
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
