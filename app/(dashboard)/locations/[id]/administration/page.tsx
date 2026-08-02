import { AdministrationTab } from "@/components/locations/administration-tab"

export default async function AdministrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdministrationTab locationId={id} />
}
