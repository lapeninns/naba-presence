import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of a settings page while it loads: the title and its line of
 * description, then two cards. It fills the layout's content pane, so from
 * md the real section list stays beside it as the way round. It claims
 * nothing about what is inside, only that a page is on its way, and is as
 * tall as the real header, so nothing jumps when the page arrives.
 */
export default function SettingsLoading() {
  return (
    <div
      className="flex flex-col gap-(--np-gap-section)"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading settings</span>
      <div
        data-slot="settings-loading-header"
        className="flex flex-col gap-1.5"
      >
        <Skeleton className="h-8 w-52 max-w-full" />
        <Skeleton className="h-5 w-full max-w-xl" />
        <Skeleton className="h-5 w-2/3 max-w-md" />
      </div>
      {[3, 2].map((rows, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)"
        >
          <Skeleton className="h-5 w-1/3" />
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton key={row} className="h-(--np-control-h) w-full" />
          ))}
        </div>
      ))}
    </div>
  )
}
