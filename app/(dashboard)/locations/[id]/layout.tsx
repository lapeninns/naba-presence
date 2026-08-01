import { LocationWorkspace } from "@/components/locations/location-workspace"
import { getSession } from "@/lib/server/session"

export default async function LocationLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>
  children: React.ReactNode
}) {
  const { id } = await params
  const session = await getSession()
  return (
    <LocationWorkspace locationId={id} role={session?.role ?? null}>
      {children}
    </LocationWorkspace>
  )
}
