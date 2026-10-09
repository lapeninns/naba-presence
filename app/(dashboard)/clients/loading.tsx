import { ClientsSkeleton } from "@/components/clients/clients-index"
import { Skeleton } from "@/components/ui/skeleton"

// A plain `div`, not `PageFrame`: this streams in beside the shell while the
// page that owns the one `<main>` is still on its way. Same paddings, the
// page title, then the index's own loading shape, the one it draws while its
// query is pending, so nothing shifts on swap.
export default function Loading() {
  return (
    <div className="@container mx-auto flex w-full max-w-(--np-page-max-width) flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)">
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <ClientsSkeleton />
    </div>
  )
}
