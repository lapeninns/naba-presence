import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

/**
 * The workspace in outline while the route loads, in the places the real
 * parts take: the summary tile, the queue chips, the filter row, the list
 * card and — from lg, where the two panes sit side by side — the detail
 * card. Says it is loading in words, not only in grey blocks.
 */
export default function InboxLoading() {
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <PageHeader title="Inbox" />
      <div
        role="status"
        aria-busy="true"
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <div className="flex shrink-0 flex-col gap-3" aria-hidden>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-[58px] w-[170px] rounded-(--np-radius-card)" />
            <div className="flex flex-1 items-center gap-2">
              <Skeleton className="h-8 w-32 rounded-(--np-radius-pill)" />
              <Skeleton className="h-8 w-28 rounded-(--np-radius-pill)" />
            </div>
          </div>
          <div className="flex gap-2 overflow-hidden">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton
                key={index}
                className="h-8 w-24 shrink-0 rounded-(--np-radius-pill)"
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-(--np-field-h) max-w-[340px] flex-[1_1_220px]" />
            <Skeleton className="h-(--np-field-h) w-40" />
            <Skeleton className="h-(--np-field-h) w-36" />
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[clamp(320px,34%,440px)_minmax(0,1fr)]">
          <div
            className="flex min-h-0 flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface"
            aria-hidden
          >
            <div className="flex h-11 items-center gap-2.5 border-b border-line bg-surface-alt px-3">
              <Skeleton className="size-[18px] rounded-[5px]" />
              <Skeleton className="h-3 w-20" />
            </div>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div
                key={index}
                className="grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 border-b border-line py-3 pr-3.5 pl-3"
              >
                <span />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-3.5 w-[55%]" />
                  <Skeleton className="h-3.5 w-[90%]" />
                  <Skeleton className="h-3.5 w-[35%]" />
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
        </div>
        <p className="sr-only lg:hidden">Loading reviews</p>
      </div>
    </PageFrame>
  )
}
