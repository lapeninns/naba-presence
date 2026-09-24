import { HydrationBoundary } from "@tanstack/react-query"

import { AreaFrame } from "@/components/listings/area-frame"
import { PostsTab } from "@/components/locations/posts-tab"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { listingPagePrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Posts")
}

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
