import { ClientsSkeleton } from "@/components/clients/clients-index"
import { Skeleton } from "@/components/ui/skeleton"

// A plain `div`, not `PageFrame`: this streams in beside the shell while the
// page that owns the one `<main>` is still on its way. It copies
// `PageFrame width="wide"`'s gutters and max width, then `PageHeader`'s
// shape (title, one line of description, the two actions, which take the
// full width on a phone), then the index's own loading shape, the one it
// draws while its query is pending, so nothing shifts on swap.
export default function Loading() {
  return (
    <div className="@container mx-auto flex w-full max-w-(--np-page-max-width) flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)">
      <div
        aria-hidden
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="flex min-w-0 grow basis-90 flex-col gap-1.5">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-6 w-80 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2 @max-md:w-full @max-md:*:flex-1">
          <Skeleton className="h-(--np-control-h) w-32 rounded-(--np-radius-control)" />
          <Skeleton className="h-(--np-control-h) w-32 rounded-(--np-radius-control)" />
        </div>
      </div>
      <ClientsSkeleton />
    </div>
  )
}
