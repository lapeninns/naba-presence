import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { SuggestionsTab } from "@/components/locations/suggestions/suggestions-page"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Suggested updates · Listing · NabaPresence" }

export default async function ListingSuggestionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <AreaFrame locationId={id} role={session?.role ?? null} area="suggestions">
        <SuggestionsTab locationId={id} />
      </AreaFrame>
    </HydrationBoundary>
  )
}
