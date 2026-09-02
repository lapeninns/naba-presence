import { HydrationBoundary } from "@tanstack/react-query"

import { PageHeader } from "@/components/app-shell/page-frame"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { PostsTab } from "@/components/locations/posts-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Posts · NabaPresence" }

export default async function PostsPage() {
  const session = await getSession()
  const { locationId } = await resolvePrimaryLocation()
  const state = await prefetch(
    session,
    locationTabPrefetch(locationId, "posts")
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Posts"
        description="Updates, offers and events you publish to Google."
      />
      {locationId ? (
        <HydrationBoundary state={state}>
          <PostsTab locationId={locationId} />
        </HydrationBoundary>
      ) : (
        <NoLocationEmpty role={session?.role ?? null} />
      )}
    </div>
  )
}
