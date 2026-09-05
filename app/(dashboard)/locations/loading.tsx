import { Skeleton } from "@/components/ui/skeleton"

// Plain `div`, not `PageFrame` — same reason as app/(dashboard)/loading.tsx:
// this streams in alongside the real page, which owns the one true `<main>`,
// and a second landmark here trips axe's landmark-no-duplicate-main for the
// instant both are mounted. Paddings mirror PageFrame width="wide" so the
// swap doesn't shift, and the blocks mirror the index: header, then a group
// caption over a white card of rows.
export default function LocationsLoading() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex w-full max-w-7xl flex-col gap-(--np-gap-section) px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5 px-(--np-card-pad)">
          <Skeleton className="size-6 rounded-(--np-radius-control)" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex flex-col divide-y divide-line-subtle rounded-(--np-radius-card) bg-surface px-(--np-cell-px)">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex h-(--np-row-h) items-center gap-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="ml-auto h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
