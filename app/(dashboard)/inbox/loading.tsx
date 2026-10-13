import { PageFrame } from "@/components/app-shell/page-frame"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { INBOX_SPLIT_STYLE } from "@/lib/inbox/layout"

/**
 * The workspace in outline while the route loads, in the places the real
 * parts take (components/inbox/inbox-toolbar.tsx, list-header.tsx,
 * inbox-view.tsx). On a phone the toolbar is three rows — the title and the
 * actions, search beside Filters, then the queue strip — above the list,
 * edge to edge. From md the title, search and actions share a row, with the
 * queues and Filters under it; from lg the review card sits beside the list.
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 xl:gap-4">
        <div className="flex shrink-0 flex-col gap-3 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-2 max-md:gap-y-2.5">
          <div className="flex min-w-0 items-center gap-3 max-md:contents">
            <div className="flex min-w-0 flex-1 items-baseline gap-3 max-md:col-start-1 max-md:row-start-1">
              <h1 className="font-display text-section font-semibold text-ink md:text-page-title">
                Inbox
              </h1>
            </div>
            <Skeleton
              aria-hidden
              className="h-(--np-field-h) max-md:col-start-1 max-md:row-start-2 md:w-56 lg:w-72"
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
                  className="h-(--np-control-h) w-24 shrink-0 rounded-(--np-radius-pill)"
                />
              ))}
            </div>
            <div className="flex flex-1 justify-end max-md:col-start-2 max-md:row-start-2">
              <Skeleton className="h-(--np-control-h) w-24" />
            </div>
          </div>
        </div>

        <div
          role="status"
          aria-busy="true"
          style={INBOX_SPLIT_STYLE}
          className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[var(--inbox-list-w)_minmax(0,1fr)] xl:gap-4"
        >
          <div
            className="flex min-h-0 flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface max-md:-mx-4 max-md:rounded-none max-md:border-x-0"
            aria-hidden
          >
            <div className="flex min-h-11 items-center gap-2.5 border-b border-line px-3">
              <Skeleton className="h-3 w-20" />
            </div>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div
                key={index}
                className="flex gap-2.5 border-b border-line py-3 pr-3.5 pl-3"
              >
                <span className="w-5.5 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3.5 w-11/12" />
                  <Skeleton className="h-3.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
          <div className="hidden min-h-0 items-center justify-center rounded-(--np-radius-card) border border-line bg-surface lg:flex">
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
