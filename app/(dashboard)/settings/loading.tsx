import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of a settings page while it loads: the title, the Policy ·
 * Connections tab row, then two cards. It claims nothing about what is
 * inside — only that a page is on its way.
 */
export default function SettingsLoading() {
  return (
    <div
      className="flex flex-col gap-(--np-gap-section)"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading settings</span>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="flex h-10 items-end gap-4 border-b border-line pb-2">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      {[3, 2].map((rows, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)"
        >
          <Skeleton className="h-4 w-1/3" />
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      ))}
    </div>
  )
}
