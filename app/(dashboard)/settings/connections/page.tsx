import { AccessDenied } from "@/components/app-shell/access-denied"

import { ConnectionsWorkspace } from "@/components/settings/connections-workspace"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Google Business Profile · NabaPresence" }

export default async function SettingsConnectionsPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    return <AccessDenied area="Google connections" />
  }
  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      <PageHeader
        title="Google Business Profile"
        description="The Google accounts this agency has connected, which clients depend on each, and how Google tells us about new reviews."
      />
      <ConnectionsWorkspace />
    </div>
  )
}
