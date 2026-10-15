import { ReviewPublish } from "@/components/listings/review-publish"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params, "Review & publish")
}

/** Everything saved here and not yet on Google, reviewed and published once. */
export default async function ListingChangesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  return <ReviewPublish locationId={id} role={session?.role ?? null} />
}
