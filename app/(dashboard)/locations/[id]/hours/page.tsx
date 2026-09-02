import { HydrationBoundary } from "@tanstack/react-query"

import { HoursTab } from "@/components/locations/hours-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function HoursPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id, "hours"))
  return (
    <HydrationBoundary state={state}>
      <HoursTab locationId={id} />
    </HydrationBoundary>
  )
}
