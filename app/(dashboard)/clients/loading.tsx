import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// A plain `div`, not `PageFrame`: this streams in beside the shell while the
// page that owns the one `<main>` is still on its way. Same paddings and the
// same shapes (a title, four health tiles, then a list card of rows), so
// nothing shifts on swap.
export default function Loading() {
  return (
    <div
      aria-busy="true"
      role="status"
      className="@container mx-auto flex w-full max-w-(--np-page-max-width) flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 @min-[760px]:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            className="h-[68px] rounded-(--np-radius-card)"
          />
        ))}
      </div>
      <p className="flex items-center gap-2 text-ui text-ink-muted">
        <Spinner decorative size="sm" className="shrink-0" />
        Loading clients
      </p>
      <div className="divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="flex h-(--np-row-h) items-center gap-3 px-(--np-cell-px)"
          >
            <Skeleton className="size-8 rounded-(--np-radius-control)" />
            <Skeleton className="h-3.5 w-40 max-w-[40%]" />
            <Skeleton className="ml-auto h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
