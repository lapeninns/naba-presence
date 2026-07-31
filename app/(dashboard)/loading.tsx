import { Skeleton } from "@/components/ui/skeleton"

// Deliberately a plain `div`, not `PageFrame` — this file renders INSIDE the
// dashboard layout while the segment below it streams in, alongside
// AppShell's chrome. Reusing PageFrame here would render a second `<main>`
// for the instant before the real page (which owns the one true `<main>`)
// finishes streaming. Same paddings as PageFrame so nothing shifts on swap.
export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex w-full max-w-(--nr-page-max-width) flex-col gap-(--nr-gap-section) px-5 py-6 md:px-(--nr-page-pad-x) md:py-(--nr-page-pad-y)"
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>
      <div className="grid gap-(--nr-gap-section) sm:grid-cols-2">
        <Skeleton className="h-32 rounded-(--nr-radius-card)" />
        <Skeleton className="h-32 rounded-(--nr-radius-card)" />
      </div>
    </div>
  )
}
