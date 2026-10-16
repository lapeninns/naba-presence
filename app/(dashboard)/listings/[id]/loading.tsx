"use client"

import { useInAreaFrame } from "@/components/listings/area-frame-context"
import { ListingSkeleton } from "@/components/listings/listing-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

// Between two areas the header stays (it lives in `[id]/layout.tsx`, LST-14),
// so this draws only the editor's card inside it. Elsewhere (the overview,
// Review & publish) the whole page's shape.
export default function ListingLoading() {
  const inFrame = useInAreaFrame()
  if (inFrame)
    return (
      <Skeleton
        aria-busy="true"
        className="h-40 w-full rounded-(--np-radius-card)"
      />
    )
  return <ListingSkeleton />
}
