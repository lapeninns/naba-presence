import { HydrationBoundary } from "@tanstack/react-query"
import { headers } from "next/headers"

import { PageFrame } from "@/components/app-shell/page-frame"
import { InboxView } from "@/components/inbox/inbox-view"
import { ShortcutsButton } from "@/components/inbox/shortcuts-button"
import { SyncReviewsButton } from "@/components/inbox/sync-reviews-button"
import { REQUEST_PATH_HEADER } from "@/lib/api/next-path"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { bulkActionsEnabled } from "@/lib/server/bulk-listings"
import { inboxPrefetch, prefetch } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Inbox · NabaPresence" }

/**
 * The query string this request was made with, from the header proxy.ts sets
 * (path + search). Empty when the header is missing, which only costs the
 * prefetch: the view still reads its state from the URL.
 */
async function requestSearch(): Promise<URLSearchParams> {
  const requested = (await headers()).get(REQUEST_PATH_HEADER)
  if (!requested) return new URLSearchParams()
  try {
    return new URL(requested, "https://placeholder.invalid").searchParams
  } catch {
    return new URLSearchParams()
  }
}

// The landing page. Deliberately no `searchParams` prop: the inbox keeps its
// filters, queue and selection in the URL, and Next tracks which segments
// read `searchParams`. A page that read them would re-render on the server
// for every one of those changes (the auto-select on load included), and
// Next then moved focus to the re-rendered segment, which wiped text an
// operator had already typed into the location filter. Changes made in the
// page keep reusing this segment and the list fetches client-side.
//
// The first load is different: waiting for the client bundle before asking
// for the rows put the list ~3 s behind first paint on a phone. So the
// request's own query string (from proxy.ts's header, which Next does not
// treat as a search-param read) picks what to prefetch: the list's first
// page, the client-scoped counts and an open review, under the keys the
// view's hooks read on their first render (lib/server/prefetch.ts).
export default async function InboxPage() {
  const [session, { locationCount }, search] = await Promise.all([
    getSession(),
    resolvePrimaryLocation(),
    requestSearch(),
  ])
  // Bulk approve and template replies run on the bulk engine (and survive
  // the tab closing) where the organisation has bulk changes on.
  const [state, bulkEngine] = await Promise.all([
    prefetch(session, inboxPrefetch(search)),
    session ? bulkActionsEnabled(session.organisationId) : false,
  ])
  // The inbox draws its own compact toolbar (title, search, queues and
  // filters in one band), so the page hands it the actions rather than
  // rendering a PageHeader above it.
  return (
    <PageFrame
      width="workspace"
      className="min-h-0 flex-1 gap-3 pt-4 max-md:px-4 max-md:pt-3 md:pt-4"
    >
      <HydrationBoundary state={state}>
        <InboxView
          showLocationFilter={locationCount > 1}
          bulkEngine={bulkEngine}
          actions={
            <>
              <ShortcutsButton />
              <SyncReviewsButton canSync={canTriggerSync(session?.role)} />
            </>
          }
        />
      </HydrationBoundary>
    </PageFrame>
  )
}
