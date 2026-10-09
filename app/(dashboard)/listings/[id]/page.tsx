import { HydrationBoundary } from "@tanstack/react-query"

import { ListingOverview } from "@/components/listings/listing-overview"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params)
}

/** One listing's home: its state, its areas, its recent activity. */
export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <ListingOverview locationId={id} role={session?.role ?? null} />
    </HydrationBoundary>
  )
}
