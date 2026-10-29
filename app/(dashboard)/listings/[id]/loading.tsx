"use client"

import { useInAreaFrame } from "@/components/listings/area-frame-context"
import { ListingSkeleton } from "@/components/listings/listing-skeleton"
import { QueryPending } from "@/components/ui/query-states"

// Between two areas the header stays (it lives in `[id]/layout.tsx`, LST-14),
// so this draws only the editor's pending rows inside it (Review & publish
// included), announced, in the shape the editor's own loading state takes
// next. From `ui/query-states`, not `locations/tab-states`, to keep this
// chunk small. Elsewhere (the overview) the whole page's shape.
export default function ListingLoading() {
  const inFrame = useInAreaFrame()
  if (inFrame) return <QueryPending label="Loading this page…" />
  return <ListingSkeleton />
}
