import { headers } from "next/headers"

import { AreaEditor } from "@/components/listings/area-frame"
import { StreamedTab } from "@/components/listings/streamed-tab"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import {
  reviewLinkBaseUrlFromHeaders,
  reviewLinkTabPrefetch,
} from "@/lib/server/review-links"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Review link")
}

// The header, capabilities and summary come from the listing's layout
// (app/(dashboard)/listings/[id]/layout.tsx). The link's state is DB-only
// (lib/server/review-links.ts) and streamed behind the tab's pending state.
export default async function ListingReviewLinkPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session, requestHeaders] = await Promise.all([
    params,
    getSession(),
    headers(),
  ])
  return (
    <StreamedTab
      session={session}
      entries={reviewLinkTabPrefetch(
        id,
        reviewLinkBaseUrlFromHeaders(requestHeaders)
      )}
      loadingLabel="review link"
    >
      <AreaEditor
        area="reviewLink"
        locationId={id}
        role={session?.role ?? null}
      />
    </StreamedTab>
  )
}
