import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// Deliberately a plain `div`, not `PageFrame` — this file renders INSIDE the
// dashboard layout while the segment below it streams in, alongside
// AppShell's chrome. Reusing PageFrame here would render a second `<main>`
// for the instant before the real page (which owns the one true `<main>`)
// finishes streaming. Same paddings as PageFrame so nothing shifts on swap.
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
      className="mx-auto flex w-full max-w-(--np-page-max-width) flex-col gap-(--np-gap-section) px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48 rounded-(--np-radius-tag)" />
        <Skeleton className="h-4 w-72 max-w-full rounded-(--np-radius-tag)" />
      </div>
      <p className="flex items-center gap-2 text-ui text-ink-muted">
        <Spinner decorative className="size-3.5 shrink-0" />
        Loading this page
      </p>
      <div className="grid gap-(--np-gap-card) sm:grid-cols-2">
        <Skeleton className="h-32 rounded-(--np-radius-card)" />
        <Skeleton className="h-32 rounded-(--np-radius-card)" />
      </div>
    </div>
  )
}
