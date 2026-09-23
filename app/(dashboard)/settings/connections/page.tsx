import { AccessDenied } from "@/components/app-shell/access-denied"
import { ConnectionsWorkspace } from "@/components/settings/connections-workspace"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Google Business Profile · NabaPresence" }

export default async function SettingsConnectionsPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    return <AccessDenied area="Google connections" />
  }
  return <ConnectionsWorkspace role={session.role} />
}
