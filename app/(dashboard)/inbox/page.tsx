import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { InboxView } from "@/components/inbox/inbox-view"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"

// The route stays /inbox; only the name changes. See the note on NAV_ITEMS in
// components/app-shell/nav.tsx.
export const metadata = { title: "Reviews · NabaPresence" }

// Deliberately no server prefetch here: the inbox keeps its filters, queue and
// selection in the URL, and a page that read `searchParams` would re-render on
// the server for every one of those changes (the auto-select on load included).
// Next then moves focus to the re-rendered segment, which wiped text an
// operator had already typed into the location filter. The list hydrates
// client-side as before.
export default async function InboxPage() {
  const { locationCount } = await resolvePrimaryLocation()
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
      <InboxView showLocationFilter={locationCount > 1} />
    </PageFrame>
  )
}
