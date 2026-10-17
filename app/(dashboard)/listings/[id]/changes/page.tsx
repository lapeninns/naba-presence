import { AreaEditor } from "@/components/listings/area-frame"
import { StreamedTab } from "@/components/listings/streamed-tab"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { changesTabPrefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Review & publish")
}

// Everything saved here and not yet on Google, reviewed and published once.
// The header, capabilities and summary come from the listing's layout
// (app/(dashboard)/listings/[id]/layout.tsx); the live read of each area with
// saved edits reaches Google and is streamed behind the tab's pending state
// (components/listings/streamed-tab.tsx), as on every area page (LST-14).
export default async function ListingChangesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  return (
    <StreamedTab
      session={session}
      entries={changesTabPrefetch(id)}
      loadingLabel="changes to review"
    >
      <AreaEditor area="changes" locationId={id} role={session?.role ?? null} />
    </StreamedTab>
  )
}
