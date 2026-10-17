import { HydrationBoundary } from "@/lib/queries/hydration-boundary"

import { AccessDenied } from "@/components/app-shell/access-denied"
import { PageHeader } from "@/components/app-shell/page-frame"
import { OperationsView } from "@/components/settings/operations-view"
import { SettingsNav } from "@/components/settings/settings-nav"
import { operationsPrefetch } from "@/lib/server/operations-prefetch"
import { prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Operations · NabaPresence" }

export default async function SettingsOperationsPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    return <AccessDenied area="Operations" />
  }
  // The counters, the failed events and the time zone are read here, so the
  // figures are in the first HTML instead of skeletons (SET-22).
  const state = await prefetch(session, operationsPrefetch())
  return (
    <>
      <PageHeader
        title="Operations"
        description="Background health for your organisation: scheduler, sync freshness, queued work, unresolved Google writes and notification email."
        tabs={<SettingsNav role={session.role} />}
      />
      <HydrationBoundary state={state}>
        <OperationsView />
      </HydrationBoundary>
    </>
  )
}
