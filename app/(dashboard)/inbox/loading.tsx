import { PageFrame } from "@/components/app-shell/page-frame"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

/**
 * The workspace in outline while the route loads, in the places the real
 * parts take (components/inbox/inbox-toolbar.tsx, inbox-view.tsx): the
 * compact toolbar — title, search and actions, then the queue track and the
 * Filters button — above the list card and, from md, the detail card beside
 * it. Says it is loading in words, not only in grey blocks.
 */
export default function InboxLoading() {
  return (
    <PageFrame
      width="workspace"
      className="min-h-0 flex-1 gap-3 pt-4 max-md:px-4 max-md:pt-3 md:pt-4"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 xl:gap-4">
        <div className="flex shrink-0 flex-col gap-3 max-md:gap-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="flex-1 font-display text-[clamp(22px,1.1vw+15px,28px)] leading-[1.18] font-semibold text-ink">
              Inbox
            </h1>
            <div aria-hidden className="flex shrink-0 items-center gap-2">
              <Skeleton className="h-(--np-field-h) w-[300px] max-lg:w-[220px] max-md:hidden" />
              <Skeleton className="size-(--np-control-h) md:hidden" />
              <Skeleton className="h-[30px] w-24 max-md:w-9" />
            </div>
          </div>
          <div aria-hidden className="flex min-w-0 items-center gap-2 md:gap-3">
            <div className="flex min-w-0 gap-0.5 overflow-hidden rounded-[10px] border border-line bg-surface-sunken p-[3px] max-md:flex-1">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton
                  key={index}
                  className="h-[30px] w-[92px] shrink-0 rounded-[7px] max-md:h-[38px]"
                />
              ))}
            </div>
            <span className="flex-1 max-md:hidden" />
            <Skeleton className="h-(--np-control-h) w-24 shrink-0" />
          </div>
        </div>

        <div
          role="status"
          aria-busy="true"
          className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] xl:grid-cols-[clamp(320px,32%,420px)_minmax(0,1fr)] xl:gap-4 md:[@media(min-height:620px)]:min-h-0"
        >
          <div
            className="flex min-h-0 flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface max-md:-mx-4 max-md:rounded-none max-md:border-x-0"
            aria-hidden
          >
            <div className="flex min-h-11 items-center gap-2.5 border-b border-line px-3 py-2">
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
          <div className="hidden min-h-0 items-center justify-center rounded-(--np-radius-card) border border-line bg-surface md:flex">
            <p className="flex items-center gap-2 text-ui text-ink-muted">
              <Spinner decorative size="sm" />
              Loading reviews
            </p>
          </div>
          <p className="sr-only md:hidden">Loading reviews</p>
        </div>
      </div>
    </PageFrame>
  )
}
