import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { LocationsIndex } from "@/components/locations/locations-index"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Locations · NabaPresence" }

export default async function LocationsPage() {
  const session = await getSession()
  return (
    <PageFrame width="wide">
      <PageHeader title="Locations" description="Every location in this organisation and the state of its Google link." />
      <LocationsIndex role={session?.role ?? null} />
    </PageFrame>
  )
}
