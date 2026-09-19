import { HydrationBoundary } from "@tanstack/react-query"

import { ReviewPublish } from "@/components/listings/review-publish"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Review & publish · Listing · NabaPresence" }

/** Everything saved here and not yet on Google, reviewed and published once. */
export default async function ListingChangesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <ReviewPublish locationId={id} role={session?.role ?? null} />
    </HydrationBoundary>
  )
}
