import { ProfileTab } from "@/components/locations/profile-tab"

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProfileTab locationId={id} />
}
