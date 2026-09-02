import { HydrationBoundary } from "@tanstack/react-query"

import { PhotosTab } from "@/components/locations/photos-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function PhotosPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id, "photos"))
  return (
    <HydrationBoundary state={state}>
      <PhotosTab locationId={id} />
    </HydrationBoundary>
  )
}
