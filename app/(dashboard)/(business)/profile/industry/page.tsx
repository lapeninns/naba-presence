import { redirect } from "next/navigation"

import { PageHeader } from "@/components/app-shell/page-frame"
import { IndustryTab } from "@/components/locations/industry-tab"
import { NoLocationEmpty } from "@/components/locations/no-location-empty"
import { resolvePrimaryLocation } from "@/lib/server/primary-location"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Industry details · NabaPresence" }

export default async function IndustryPage() {
  const session = await getSession()
  // GET /api/locations/[id]/industry is owner/admin-only, so a member reaching
  // this URL directly would render a page of 403s. ProfileNav already hides
  // the link for them; this closes the direct-URL path, mirroring
  // app/(dashboard)/settings/connections/page.tsx.
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    redirect("/profile")
  }
  const { locationId } = await resolvePrimaryLocation()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Industry details"
        description="Extra details Google collects for your kind of business."
      />
      {locationId ? (
        <IndustryTab locationId={locationId} />
      ) : (
        <NoLocationEmpty role={session.role} />
      )}
    </div>
  )
}
