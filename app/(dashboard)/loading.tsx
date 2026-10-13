import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

const ROWS = 6

// Renders INSIDE AppShell's `<main id="main">` while the segment below it
// streams in, so the skip link has its target throughout; this file adds no
// landmark of its own. Same paddings as PageFrame so nothing shifts on swap.
//
// The sentence is not decoration. Every Skeleton is aria-hidden and aria-busy
// on a div announces nothing, so without it this state is silent to a screen
// reader and, to everyone else, grey shapes that look the same at 400ms and
// at 30s. It says only what is true: the page is loading. It does not name
// what the page will hold, because this file cannot know.
//
// The shapes are the shape most pages take: a header (title and a muted
// count) over list rows (a 32px avatar circle and three lines, divided by a
// hairline inset to the text column). Skeleton stops its shimmer under
// reduced motion.
export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      role="status"
      className="mx-auto flex w-full max-w-(--np-page-default-width) flex-col gap-4 px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-40 max-w-full rounded-sm" />
        <Skeleton className="h-6 w-8 rounded-sm opacity-60" />
      </div>
      <p className="flex items-center gap-2 text-ui text-ink-muted">
        <Spinner decorative className="size-3.5 shrink-0" />
        Loading this page
      </p>
      <div aria-hidden="true" className="flex flex-col">
        {Array.from({ length: ROWS }, (_, index) => (
          <div key={index} className="flex items-start gap-3 pt-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div
              className={
                index === ROWS - 1
                  ? "flex min-w-0 flex-1 flex-col gap-1.5 pb-3"
                  : "flex min-w-0 flex-1 flex-col gap-1.5 border-b border-line-subtle pb-3"
              }
            >
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
