import { LocationWorkspace } from "@/components/naba-presence/location-workspace"

export default async function LocationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <LocationWorkspace locationId={id}>{children}</LocationWorkspace>
}
