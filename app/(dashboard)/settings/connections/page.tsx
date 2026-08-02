import { redirect } from "next/navigation"

import { ConnectionsWorkspace } from "@/components/settings/connections-workspace"
import { PageHeader } from "@/components/app-shell/page-frame"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Google Business Profile · NabaPresence" }

export default async function SettingsConnectionsPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    redirect("/settings")
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Google Business Profile" description="Connect Google, choose accounts, import locations and manage notifications." />
      <ConnectionsWorkspace />
    </div>
  )
}
