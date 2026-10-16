import { ListingOverview } from "@/components/listings/listing-overview"
import { listingPageMetadata } from "@/lib/server/listing-metadata"
import { getSession } from "@/lib/server/session"

/** The venue's name in the tab title, from one DB row; never Google. */
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return listingPageMetadata(params)
}

/** One listing’s home: its state, its areas and its health. */
export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const [{ id }, session] = await Promise.all([params, getSession()])
  return <ListingOverview locationId={id} role={session?.role ?? null} />
}
