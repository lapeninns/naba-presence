import { HydrationBoundary } from "@tanstack/react-query"

import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { InboxView } from "@/components/inbox/inbox-view"
import { ShortcutsButton } from "@/components/inbox/shortcuts-button"
import { SyncReviewsButton } from "@/components/inbox/sync-reviews-button"
import { canTriggerSync } from "@/lib/reporting/sync-permission"
import { inboxPrefetch, prefetch } from "@/lib/server/prefetch"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Inbox · NabaPresence" }

// The landing page. Deliberately no `searchParams` here: the inbox keeps its
// filters, queue and selection in the URL, and a page that read them would
// re-render on the server for every one of those changes (the auto-select on
// load included). Next then moves focus to the re-rendered segment, which
// wiped text an operator had already typed into the location filter. The
// list hydrates client-side; only the Today strip's org-wide figures, which
// never depend on the query string, are prefetched.
export default async function InboxPage() {
  const [session, { locationCount }] = await Promise.all([
    getSession(),
    resolvePrimaryLocation(),
  ])
  const state = await prefetch(session, inboxPrefetch())
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <PageHeader
        title="Inbox"
        // The sentence is dropped on phones and short windows, where the
        // workspace needs the height more than the reminder.
        description={
          <span className="max-md:hidden [@media(max-height:619.98px)]:hidden">
            Every client&rsquo;s reviews in one queue. Nothing reaches Google
            until a verified reply is published.
          </span>
        }
        actions={
          <>
            <ShortcutsButton />
            <SyncReviewsButton canSync={canTriggerSync(session?.role)} />
          </>
        }
      />
      <HydrationBoundary state={state}>
        <InboxView showLocationFilter={locationCount > 1} />
      </HydrationBoundary>
    </PageFrame>
  )
}
