import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// Renders INSIDE AppShell's `<main id="main">` while the segment below it
// streams in, so the skip link has its target throughout; this file adds no
// landmark of its own. Same paddings as PageFrame so nothing shifts on swap.
//
// The sentence is not decoration. Every Skeleton is aria-hidden and aria-busy
// on a div announces nothing, so without it this state is silent to a screen
// reader and, to everyone else, two grey shapes that look the same at 400ms
// and at 30s. It says only what is true: the page is loading. It does not
// name what the page will hold, because this file cannot know.
export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      role="status"
      className="mx-auto flex w-full max-w-(--np-page-default-width) flex-col gap-(--np-gap-section) px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56 max-w-full rounded-sm" />
        <Skeleton className="h-4 w-80 max-w-full rounded-sm" />
      </div>
      <p className="flex items-center gap-2 text-ui text-ink-muted">
        <Spinner decorative className="size-3.5 shrink-0" />
        Loading this page
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
      <Skeleton className="h-60 rounded-lg" />
    </div>
  )
}
