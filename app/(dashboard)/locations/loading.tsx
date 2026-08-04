import { Skeleton } from "@/components/ui/skeleton"

// Plain `div`, not `PageFrame` — same reason as app/(dashboard)/loading.tsx:
// this streams in alongside the real page, which owns the one true `<main>`,
// and a second landmark here trips axe's landmark-no-duplicate-main for the
// instant both are mounted. Paddings mirror PageFrame width="wide" so the
// swap doesn't shift.
export default function LocationsLoading() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex w-full max-w-7xl flex-col gap-(--nr-gap-section) px-5 py-6 md:px-(--nr-page-pad-x) md:py-(--nr-page-pad-y)"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  )
}
