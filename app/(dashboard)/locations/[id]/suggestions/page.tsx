import { HydrationBoundary } from "@tanstack/react-query"

import { SuggestionsTab } from "@/components/locations/suggestions/suggestions-page"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function SuggestionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <SuggestionsTab locationId={id} />
    </HydrationBoundary>
  )
}
