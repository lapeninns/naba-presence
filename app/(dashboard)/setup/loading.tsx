import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of setup while it loads: the title block, then the step rail
 * beside the step card (the rail folds away on a narrow screen, as the page
 * does). A plain `div`, not `PageFrame`: the page owns the one `<main>`.
 */
export default function Loading() {
  return (
    <div
      className="@container mx-auto flex w-full max-w-(--np-page-default-width) flex-col gap-(--np-gap-section) px-5 pt-6 pb-12 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading client setup</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid items-start gap-6 @min-[720px]:grid-cols-[13.75rem_minmax(0,1fr)]">
        <div className="hidden flex-col gap-2 @min-[720px]:flex">
          {Array.from({ length: 9 }, (_, index) => (
            <Skeleton key={index} className="h-8" />
          ))}
        </div>
        <div className="flex flex-col gap-3.5 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-6 w-64 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-36 w-full rounded-(--np-radius-card)" />
        </div>
      </div>
    </div>
  )
}
