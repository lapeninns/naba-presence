import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { LocationsIndex } from "@/components/locations/locations-index"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Locations · NabaPresence" }

export default async function LocationsPage() {
  const session = await getSession()
  return (
    <PageFrame width="wide">
      <PageHeader
        title="All locations"
        eyebrow="Clients"
        description="Every location you manage, grouped by the client it belongs to."
      />
      <LocationsIndex role={session?.role ?? null} />
    </PageFrame>
  )
}
