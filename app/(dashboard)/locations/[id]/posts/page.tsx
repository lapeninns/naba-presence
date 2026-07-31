import { LocationPostsView } from "@/components/naba-presence/location-posts-view"

export const metadata = { title: "Posts · NabaPresence" }

export default async function LocationPostsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationPostsView locationId={id} />
}
