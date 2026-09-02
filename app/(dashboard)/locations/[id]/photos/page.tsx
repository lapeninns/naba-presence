import { HydrationBoundary } from "@tanstack/react-query"

import { PhotosTab } from "@/components/locations/photos-tab"
import {
  locationTabPrefetch,
  prefetch,
  toSearchParams,
} from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function PhotosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ id }, search, session] = await Promise.all([
    params,
    searchParams,
    getSession(),
  ])
  const state = await prefetch(
    session,
    locationTabPrefetch(id, "photos", toSearchParams(search))
  )
  return (
    <HydrationBoundary state={state}>
      <PhotosTab locationId={id} />
    </HydrationBoundary>
  )
}
