import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of a listing page while it loads, matching the area header
 * (L03) so the page doesn't jump: the listing's name, the title with its
 * pill, the one-line description, the tab row from 64rem, then a white card
 * the height of a short section. Rendered inside the dashboard layout's
 * <main>, so no landmark or h1 of its own.
 */
function ListingSkeleton() {
  return (
    <div
      className="flex flex-col gap-2 px-5 pt-6 md:gap-3 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)"
      aria-busy="true"
    >
      <div className="flex flex-col gap-2">
        <div className="flex h-(--np-control-h) items-center md:h-auto">
          <Skeleton className="h-4 w-40 max-w-full" />
        </div>
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-5 w-28 rounded-(--np-radius-tag)" />
        </div>
        <Skeleton className="mt-1 hidden h-3.5 w-80 max-w-full md:mt-0 md:block" />
      </div>
      <div className="hidden gap-4 border-b border-line pb-3 lg:flex">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-4 w-20 shrink-0" />
        ))}
      </div>
      <Skeleton className="mt-4 h-40 w-full rounded-(--np-radius-card)" />
    </div>
  )
}

export { ListingSkeleton }
