import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of the setup panel while it loads: a title, then the centred
 * card with a stepper strip, a step heading and a body.
 */
export default function Loading() {
  return (
    <div
      className="flex flex-col gap-(--np-gap-section) px-5 py-6 md:px-(--np-page-pad-x) md:py-(--np-page-pad-y)"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading client setup</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 rounded-(--np-radius-panel) bg-surface p-(--np-panel-pad)">
        <Skeleton className="hidden h-6 w-full sm:block" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-40 w-full rounded-(--np-radius-card)" />
      </div>
    </div>
  )
}
