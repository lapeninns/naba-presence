import { HydrationBoundary } from "@tanstack/react-query"

import { ProfileTab } from "@/components/locations/profile-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <ProfileTab locationId={id} />
    </HydrationBoundary>
  )
}
