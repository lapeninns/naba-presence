import { AccessDeniedPage } from "@/components/app-shell/access-denied"
import { PageFrame } from "@/components/app-shell/page-frame"
import { OutboxView } from "@/components/outbox/outbox-view"
import { OUTBOX_PAGE_SIZE, outboxViewFromSearch } from "@/lib/outbox/contract"
import { HydrationBoundary } from "@/lib/queries/hydration-boundary"
import { outboxPrefetch } from "@/lib/server/outbox-prefetch"
import { prefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Outbox · NabaPresence" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * Writes on their way to Google or back from it (DIRECTION §7.1). Viewers
 * cannot send, so they have no Outbox: the navigation leaves it out for
 * them and a typed address says so here. The first page and the group
 * counts are read on the server for exactly the view the address asks for.
 */
export default async function OutboxPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const session = await getSession()
  if (session?.role === "viewer") {
    return (
      <AccessDeniedPage area="Outbox" whoCanOpen="an owner, admin or member" />
    )
  }

  const params = await searchParams
  const view = outboxViewFromSearch({
    get: (name) => {
      const value = params[name]
      return (Array.isArray(value) ? value[0] : value) ?? null
    },
  })
  const state = await prefetch(
    session,
    outboxPrefetch({ ...view, limit: OUTBOX_PAGE_SIZE })
  )

  return (
    <PageFrame>
      <HydrationBoundary state={state}>
        <OutboxView />
      </HydrationBoundary>
    </PageFrame>
  )
}
