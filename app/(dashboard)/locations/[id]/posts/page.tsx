import { HydrationBoundary } from "@tanstack/react-query"

import { PostsTab } from "@/components/locations/posts-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function PostsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id, "posts"))
  return (
    <HydrationBoundary state={state}>
      <PostsTab locationId={id} />
    </HydrationBoundary>
  )
}
