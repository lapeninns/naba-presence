import { HydrationBoundary } from "@tanstack/react-query"

import { ListingJob } from "@/components/locations/listing-job"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/**
 * The Listing job: one scroll through everything that is a fact about the
 * listing. Each section is the editor it always was, with its own fetch,
 * gate and footer; the page only stacks them and gives each an anchor.
 */
export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <ListingJob locationId={id} />
    </HydrationBoundary>
  )
}
