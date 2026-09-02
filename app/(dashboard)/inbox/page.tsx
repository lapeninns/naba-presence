import { HydrationBoundary } from "@tanstack/react-query"

import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { InboxView } from "@/components/inbox/inbox-view"
import { inboxPrefetch, prefetch, toSearchParams } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

// The route stays /inbox; only the name changes. See the note on NAV_ITEMS in
// components/app-shell/nav.tsx.
export const metadata = { title: "Reviews · NabaPresence" }

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [session, { locationCount }, params] = await Promise.all([
    getSession(),
    resolvePrimaryLocation(),
    searchParams,
  ])
  // First review page for the URL's filters + counts, under the same keys
  // InboxView's hooks read, so the list paints with data (lib/server/prefetch).
  const state = await prefetch(session, inboxPrefetch(toSearchParams(params)))
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <PageHeader
        title="Reviews"
        description={
          <span className="max-lg:hidden">
            Every Google review for your business, in one queue.
          </span>
        }
      />
      <HydrationBoundary state={state}>
        <InboxView showLocationFilter={locationCount > 1} />
      </HydrationBoundary>
    </PageFrame>
  )
}
