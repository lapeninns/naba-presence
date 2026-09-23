import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// A plain `div`, not `PageFrame`: the reports page owns the one `<main>` once
// it has streamed in. Same paddings and the report's own shapes: the title,
// the scope bar, the tab strip, four tiles, then a chart card.
export default function PerformanceLoading() {
  return (
    <div
      aria-busy="true"
      role="status"
      className="mx-auto flex w-full max-w-7xl flex-col gap-(--np-gap-section) px-(--np-page-pad-x) py-(--np-page-pad-y)"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4">
        <div className="flex min-w-0 flex-[1_1_17.5rem] items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-48 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-(--np-control-h) w-56 max-w-full rounded-(--np-radius-control)" />
      </div>
      <p className="flex items-center gap-2 text-ui text-ink-muted">
        <Spinner decorative size="sm" className="shrink-0" />
        Loading reports
      </p>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-(--np-radius-card)" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-(--np-radius-card)" />
    </div>
  )
}
