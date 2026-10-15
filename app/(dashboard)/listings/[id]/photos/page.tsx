import { AreaEditor } from "@/components/listings/area-frame"
import { StreamedTab } from "@/components/listings/streamed-tab"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { photosTabPrefetch } from "@/lib/server/prefetch"
import { requestSearch } from "@/lib/server/request-search"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Photos")
}

// The header, capabilities and summary come from the listing's layout
// (app/(dashboard)/listings/[id]/layout.tsx); the editor's own first read
// reaches Google and is streamed behind the tab's pending state
// (components/listings/streamed-tab.tsx).
//
// The filters come from the request's query string (proxy.ts's header), not
// a `searchParams` prop, as on the inbox: the prefetch keys the first page by
// them, and the tab keeps reading its filters from the URL itself.
export default async function ListingPhotosPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session, search] = await Promise.all([
    params,
    getSession(),
    requestSearch(),
  ])
  return (
    <StreamedTab
      session={session}
      entries={photosTabPrefetch(id, search)}
      loadingLabel="photos"
    >
      <AreaEditor area="photos" locationId={id} />
    </StreamedTab>
  )
}
