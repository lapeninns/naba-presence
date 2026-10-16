import { AreaEditor } from "@/components/listings/area-frame"
import { StreamedTab } from "@/components/listings/streamed-tab"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { peopleTabPrefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "People with access")
}

// The header, capabilities and summary come from the listing's layout
// (app/(dashboard)/listings/[id]/layout.tsx); the editor's own first read
// reaches Google and is streamed behind the tab's pending state
// (components/listings/streamed-tab.tsx).
export default async function ListingPeoplePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  return (
    <StreamedTab
      session={session}
      entries={peopleTabPrefetch(id)}
      loadingLabel="people with access"
    >
      <AreaEditor area="people" locationId={id} />
    </StreamedTab>
  )
}
