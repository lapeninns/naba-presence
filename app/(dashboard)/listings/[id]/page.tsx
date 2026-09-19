import { HydrationBoundary } from "@tanstack/react-query"

import { ListingOverview } from "@/components/listings/listing-overview"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Listing · NabaPresence" }

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
