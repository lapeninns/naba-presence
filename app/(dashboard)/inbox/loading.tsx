import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

/**
 * The workspace in outline while the route loads: the rail's groups, a
 * list of rows and an empty inspector, in the same places the real ones
 * take. Says it is loading in words, not only in grey blocks.
 */
export default function InboxLoading() {
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <PageHeader title="Reviews" />
      <div
        role="status"
        aria-busy="true"
        className="flex min-h-0 flex-1 gap-(--np-gap-card)"
      >
        <div
          className="hidden w-60 shrink-0 flex-col gap-6 lg:flex"
          aria-hidden
        >
          {[0, 1].map((group) => (
            <div key={group} className="flex flex-col gap-1.5">
              <Skeleton className="mb-1 h-3 w-16" />
              {[0, 1, 2, 3].map((row) => (
                <Skeleton
                  key={row}
                  className="h-8 w-full rounded-(--np-radius-control)"
                />
              ))}
            </div>
          ))}
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-(--np-radius-card) bg-surface lg:max-w-[42%]"
          aria-hidden
        >
          <div className="flex items-center gap-2 border-b border-line-subtle px-3 py-2.5">
            <Skeleton className="h-(--np-field-h) flex-1 rounded-(--np-radius-pill)" />
            <Skeleton className="h-(--np-control-h) w-28 rounded-(--np-radius-control)" />
          </div>
          {[0, 1, 2, 3, 4, 5, 6].map((index) => (
            <div
              key={index}
              className="flex items-start gap-2.5 border-b border-line-subtle px-3 py-2.5"
            >
              <Skeleton className="mt-0.5 size-6 shrink-0 rounded-(--np-radius-pill)" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-full max-w-64" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden min-h-0 flex-1 items-center justify-center rounded-(--np-radius-card) bg-surface lg:flex">
          <p className="flex items-center gap-2 text-ui text-ink-muted">
            <Spinner decorative size="sm" />
            Loading reviews
          </p>
        </div>
        <p className="sr-only lg:hidden">Loading reviews</p>
      </div>
    </PageFrame>
  )
}
