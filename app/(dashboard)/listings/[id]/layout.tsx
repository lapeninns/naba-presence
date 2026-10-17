import { HydrationBoundary } from "@/lib/queries/hydration-boundary"
import { Suspense } from "react"
import type * as React from "react"

import { ListingAreaLayout } from "@/components/listings/area-frame"
import { ListingSkeleton } from "@/components/listings/listing-skeleton"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/**
 * Every page of one listing. An area page's `AreaFrame` lives here, so
 * switching areas swaps only the editor below the header, which stays
 * mounted with its switcher, pill and tabs (LST-14). Each area page, and
 * Review & publish, streams its own live read behind `StreamedTab`. Only the
 * overview draws its own header.
 *
 * The capabilities and the DB summary are read here (pure SQL, so the
 * header and its status paint with the page) inside their own Suspense
 * boundary: `loading.tsx` sits below a layout and cannot cover the
 * layout's own reads, so without it a navigation into a listing would
 * block on them with nothing on screen.
 */
export default function ListingLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <ListingFrame params={params}>{children}</ListingFrame>
    </Suspense>
  )
}

async function ListingFrame({
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
