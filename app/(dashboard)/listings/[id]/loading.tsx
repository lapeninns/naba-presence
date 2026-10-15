"use client"

import { useInAreaFrame } from "@/components/listings/area-frame-context"
import { Skeleton } from "@/components/ui/skeleton"

// The shape of a listing page while its segment loads, matching the compact
// area header so switching areas doesn't jump: the listing's name, the title
// with its pill and the one-line description, then the area button (under
// 64rem) or the tab row, then a white card the height of a short section.
// Rendered inside the dashboard layout's <main>, so no landmark or h1 of its
// own.
//
// Between two areas the header stays (it lives in `[id]/layout.tsx`, LST-14)
// and this draws only the editor's card inside it.
export default function ListingLoading() {
  const inFrame = useInAreaFrame()
  if (inFrame)
    return (
      <Skeleton
        aria-busy="true"
        className="h-40 w-full rounded-(--np-radius-card)"
      />
    )
  return (
    <div
      className="flex flex-col gap-2 px-5 pt-6 md:gap-4 md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)"
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
        <Skeleton className="mt-1 h-3.5 w-80 max-w-full md:mt-0" />
      </div>
      <Skeleton className="h-(--np-control-h) w-full rounded-(--np-radius-control) md:w-56 lg:hidden" />
      <div className="hidden gap-4 border-b border-line pb-3 lg:flex">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-4 w-20 shrink-0" />
        ))}
      </div>
      <Skeleton className="mt-4 h-40 w-full rounded-(--np-radius-card)" />
    </div>
  )
}
