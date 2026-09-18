import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { PostsTab } from "@/components/locations/posts-tab"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Posts · Listing · NabaPresence" }

export default async function ListingPostsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, listingPagePrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <AreaFrame locationId={id} role={session?.role ?? null} area="posts">
        <PostsTab locationId={id} />
      </AreaFrame>
    </HydrationBoundary>
  )
}
