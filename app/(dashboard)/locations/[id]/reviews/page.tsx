import { LocationReviewsRoute } from "@/components/naba-presence/route-views"

export const metadata = { title: "Location reviews · NabaPresence" }

export default async function LocationReviewsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationReviewsRoute locationId={id} />
}
