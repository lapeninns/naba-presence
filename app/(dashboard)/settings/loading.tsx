import { Skeleton } from "@/components/ui/skeleton"

/**
 * The shape of a settings page while it loads: the title and its line of
 * description, the settings tab row (from md; a phone goes back through the
 * app bar), then two cards. It claims nothing about what is inside — only
 * that a page is on its way — and is as tall as the real header, so nothing
 * jumps when the page arrives.
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
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-5 w-2/3 max-w-md" />
        </div>
        <div className="flex h-11 items-end gap-4 overflow-hidden border-b border-line px-3 pb-3 max-md:hidden desk:h-10">
          {["w-24", "w-24", "w-32", "w-20", "w-16"].map((width, index) => (
            <Skeleton key={index} className={`h-4 shrink-0 ${width}`} />
          ))}
        </div>
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
