import { redirect } from "next/navigation"

import { LocationsIndexView } from "@/components/naba-presence/locations-index-view"
import { listLinkedLocationIds } from "@/lib/server/locations"

export const metadata = { title: "Locations · NabaPresence" }

export default async function LocationsPage() {
  const ids = await listLinkedLocationIds()
  if (ids.length === 1) redirect(`/locations/${ids[0]}`)

  return <LocationsIndexView />
}
