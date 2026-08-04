import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { InboxView } from "@/components/inbox/inbox-view"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"

// The route stays /inbox; only the name changes. See the note on NAV_ITEMS in
// components/app-shell/nav.tsx.
export const metadata = { title: "Reviews · NabaPresence" }

export default async function InboxPage() {
  const { locationCount } = await resolvePrimaryLocation()
  return (
    <PageFrame width="workspace" className="min-h-0 flex-1">
      <PageHeader
        title="Reviews"
        description="Every Google review for your business, in one queue."
      />
      <InboxView showLocationFilter={locationCount > 1} />
    </PageFrame>
  )
}
