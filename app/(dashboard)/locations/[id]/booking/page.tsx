import { HydrationBoundary } from "@tanstack/react-query"

import { BookingTab } from "@/components/locations/booking-tab"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <BookingTab locationId={id} />
    </HydrationBoundary>
  )
}
