import { HydrationBoundary } from "@tanstack/react-query"

import { IndustryTab } from "@/components/locations/industry-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function IndustryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id, "industry"))
  return (
    <HydrationBoundary state={state}>
      <IndustryTab locationId={id} />
    </HydrationBoundary>
  )
}
