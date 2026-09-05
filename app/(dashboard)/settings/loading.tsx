import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of a settings pane while it loads: a title, then two grouped
 * lists. It claims nothing about what is inside — only that a pane is on
 * its way.
 */
export default function SettingsLoading() {
  return (
    <div
      className="flex flex-col gap-(--np-gap-section)"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading settings</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="ml-(--np-card-pad) h-3 w-24" />
        <Skeleton className="h-[calc(var(--np-row-h)*3)] w-full rounded-(--np-radius-card)" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="ml-(--np-card-pad) h-3 w-32" />
        <Skeleton className="h-[calc(var(--np-row-h)*2)] w-full rounded-(--np-radius-card)" />
      </div>
    </div>
  )
}
