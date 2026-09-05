import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// A plain `div`, not `PageFrame`: the reports page owns the one `<main>` once
// it has streamed in. Same paddings and the report's own shapes: a title, the
// tab strip, four tiles, then a chart card.
export default function PerformanceLoading() {
  return (
    <div
      aria-busy="true"
      role="status"
      className="mx-auto flex w-full max-w-7xl flex-col gap-(--np-gap-section) px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <p className="flex items-center gap-2 text-ui text-ink-muted">
        <Spinner decorative size="sm" className="shrink-0" />
        Loading reports
      </p>
      <Skeleton className="h-(--np-control-h) w-72 max-w-full rounded-(--np-radius-control)" />
      <div className="grid gap-(--np-gap-card) sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-(--np-radius-card)" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-(--np-radius-card)" />
    </div>
  )
}
