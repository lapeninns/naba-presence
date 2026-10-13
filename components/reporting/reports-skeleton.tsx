import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

function TileSkeleton() {
  return (
    <Card size="sm" className="min-h-28 gap-2">
      <Skeleton className="mx-4 h-3.5 w-20" />
      <Skeleton className="mx-4 h-8 w-16" />
      <Skeleton className="mx-4 mt-auto h-3 w-24 max-w-full" />
    </Card>
  )
}

function ChartSkeleton() {
  return (
    <Card className="gap-4">
      <Skeleton className="mx-(--card-spacing) h-4 w-40 max-w-full" />
      <Skeleton className="mx-(--card-spacing) h-48" />
    </Card>
  )
}

/**
 * The shape of a report while it loads, matching what replaces it so nothing
 * jumps on the swap.
 *
 * - `page` (the route's loading.tsx): the PageFrame paddings, the title, the
 *   one toolbar row (a summary button on a phone, three fields from `md`),
 *   the tab strip, then the tab body.
 * - `tab`: only a tab's body: the caption line, tiles two to a row on a
 *   phone (four from 48rem of the report's container), and two chart cards.
 *
 * It is its own status region, with one sentence for screen readers.
 */
export function ReportsSkeleton({
  variant = "page",
  label = "Loading reports",
  className,
}: {
  variant?: "page" | "tab"
  label?: string
  className?: string
}) {
  const body = (
    <>
      <Skeleton className="h-3.5 w-48 max-w-full" />
      <div className="grid grid-cols-2 gap-3 @[48rem]/report:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <TileSkeleton key={tile} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-(--np-gap-card) @[60rem]/report:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </>
  )

  if (variant === "tab") {
    return (
      <div
        aria-busy="true"
        role="status"
        data-slot="reports-skeleton"
        className={cn(
          "@container/report flex flex-col gap-(--np-gap-section)",
          className
        )}
      >
        <p className="flex items-center gap-2 text-ui text-ink-muted">
          <Spinner decorative size="sm" className="shrink-0" />
          {label}
        </p>
        {body}
      </div>
    )
  }

  // A plain `div`, not `PageFrame`: the page owns the one `<main>` once it
  // has streamed in. The classes are PageFrame's `wide` frame.
  return (
    <div
      aria-busy="true"
      role="status"
      data-slot="reports-skeleton"
      className={cn(
        "@container/report mx-auto flex w-full max-w-(--np-page-max-width) flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)",
        className
      )}
    >
      <p className="sr-only">{label}</p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex items-end gap-3">
        <Skeleton className="h-(--np-control-h) flex-1 rounded-(--np-radius-control) md:hidden" />
        {[0, 1, 2].map((field) => (
          <div key={field} className="hidden flex-col gap-1.5 md:flex">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-(--np-control-h) w-56 rounded-(--np-radius-control)" />
          </div>
        ))}
      </div>
      <Skeleton className="h-11 w-full rounded-(--np-radius-control) sm:w-96" />
      {body}
    </div>
  )
}
