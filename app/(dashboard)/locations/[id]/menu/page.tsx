import { MenuTab } from "@/components/locations/menu-tab"

export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MenuTab locationId={id} />
}
