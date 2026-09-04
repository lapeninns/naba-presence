import { HydrationBoundary } from "@tanstack/react-query"

import { VerificationTab } from "@/components/locations/administration"
import { locationTabPrefetch, prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  const state = await prefetch(session, locationTabPrefetch(id))
  return (
    <HydrationBoundary state={state}>
      <VerificationTab locationId={id} />
    </HydrationBoundary>
  )
}
