import { HydrationBoundary } from "@tanstack/react-query"

import { MenuTab } from "@/components/locations/menu-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function MenuPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id, "menu"))
  return (
    <HydrationBoundary state={state}>
      <MenuTab locationId={id} />
    </HydrationBoundary>
  )
}
