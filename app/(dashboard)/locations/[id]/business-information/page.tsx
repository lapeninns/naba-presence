import { HydrationBoundary } from "@tanstack/react-query"

import { BusinessInformationTab } from "@/components/locations/business-information-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function BusinessInformationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <BusinessInformationTab locationId={id} />
    </HydrationBoundary>
  )
}
