import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

// A plain `div`, not `PageFrame`: the hub owns the one `<main>` once it has
// streamed in. Same paddings and the hub's own shapes: a mark and a title,
// four tiles, then a list card.
export default function Loading() {
  return (
    <div
      aria-busy="true"
      role="status"
      className="mx-auto flex w-full max-w-7xl flex-col gap-(--np-gap-section) px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
    >
      <div className="flex items-start gap-4">
        <Skeleton className="size-16 rounded-(--np-radius-panel)" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <p className="flex items-center gap-2 text-ui text-ink-muted">
        <Spinner decorative size="sm" className="shrink-0" />
        Loading this client
      </p>
      <div className="grid gap-(--np-gap-card) sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 rounded-(--np-radius-card)" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-(--np-radius-card)" />
    </div>
  )
}
