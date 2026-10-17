import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { ListingsBoard } from "@/components/listings/listings-board-entry"
import { bulkActionsEnabled } from "@/lib/server/bulk-listings"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Listings · NabaPresence" }

/**
 * Every Google Business Profile the agency looks after, health first.
 * No `searchParams` here: the board reads its filters on the client and
 * rewrites them through the history API (lib/navigation/shallow-url.ts), so
 * a filter change never re-renders the server segment. Not reading
 * `searchParams` alone would not do that: `router.replace` re-runs a dynamic
 * page whatever it reads.
 */
export default async function ListingsPage() {
  const session = await getSession()
  const canManage = session?.role === "owner" || session?.role === "admin"
  const bulkEnabled =
    canManage && session
      ? await bulkActionsEnabled(session.organisationId)
      : false
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Listings"
        description={
          // Words for a screen reader on a phone, where the first listing
          // belongs above the fold (LST-07); read in full from md.
          <span className="max-md:sr-only">
            Every Google Business Profile you look after, and what each one is
            waiting on.
          </span>
        }
      />
      <ListingsBoard role={session?.role ?? null} bulkEnabled={bulkEnabled} />
    </PageFrame>
  )
}
