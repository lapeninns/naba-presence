import { PhotosTab } from "@/components/locations/photos-tab"

export default async function PhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PhotosTab locationId={id} />
}
