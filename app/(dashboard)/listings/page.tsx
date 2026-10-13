import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { AddListingsLink } from "@/components/listings/add-listings-link"
import { ListingsBoard } from "@/components/listings/listings-board"
import { bulkActionsEnabled } from "@/lib/server/bulk-listings"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Listings · NabaPresence" }

/**
 * Every Google Business Profile the agency looks after, health first.
 * No `searchParams` here: the board reads its client filter on the client
 * so a filter change never re-renders the server segment.
 */
export default async function ListingsPage() {
  const session = await getSession()
  const canManage = session?.role === "owner" || session?.role === "admin"
  const bulkEnabled =
    canManage && session ? await bulkActionsEnabled(session.organisationId) : false
  return (
    <PageFrame width="wide">
      <PageHeader
        title="Listings"
        description="Every Google Business Profile you look after, and what each one is waiting on."
        actions={canManage ? <AddListingsLink /> : null}
      />
      <ListingsBoard role={session?.role ?? null} bulkEnabled={bulkEnabled} />
    </PageFrame>
  )
}
