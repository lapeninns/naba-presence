import { StreamedTab } from "@/components/listings/streamed-tab"
import { VerificationTab } from "@/components/locations/administration"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { verificationTabPrefetch } from "@/lib/server/prefetch"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Verification")
}

// The header, capabilities and summary come from the listing's layout
// (app/(dashboard)/listings/[id]/layout.tsx); the editor's own first read
// reaches Google and is streamed behind the tab's pending state
// (components/listings/streamed-tab.tsx).
export default async function ListingVerificationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  return (
    <StreamedTab
      session={session}
      entries={verificationTabPrefetch(id)}
      loadingLabel="verification"
    >
      <VerificationTab locationId={id} />
    </StreamedTab>
  )
}
