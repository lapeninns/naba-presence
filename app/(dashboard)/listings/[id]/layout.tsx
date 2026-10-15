import { HydrationBoundary } from "@/lib/queries/hydration-boundary"
import type * as React from "react"

import { ListingAreaLayout } from "@/components/listings/area-frame"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/**
 * Every page of one listing. The capabilities and the DB summary are
 * awaited here (pure SQL, so the header and its status paint at once), and
 * an area page's `AreaFrame` lives here too: switching areas swaps only the
 * editor below the header, which stays mounted with its switcher, pill and
 * tabs (LST-14). Each area page streams its own editor read behind
 * `StreamedTab`. The overview and Review & publish draw their own header.
 */
export default async function ListingLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <ListingAreaLayout locationId={id} role={session?.role ?? null}>
        {children}
      </ListingAreaLayout>
    </HydrationBoundary>
  )
}
