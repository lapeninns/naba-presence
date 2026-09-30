import { AccessDenied } from "@/components/app-shell/access-denied"
import { PageHeader } from "@/components/app-shell/page-frame"
import { OperationsView } from "@/components/settings/operations-view"
import { SettingsNav } from "@/components/settings/settings-nav"
import { getSession } from "@/lib/server/session"

export const metadata = { title: "Operations · NabaPresence" }

export default async function SettingsOperationsPage() {
  const session = await getSession()
  if (!session || (session.role !== "owner" && session.role !== "admin")) {
    return <AccessDenied area="Operations" />
  }
  return (
    <>
      <PageHeader
        title="Operations"
        description="Background health for your organisation: scheduler, sync freshness, queued work, unresolved Google writes and notification email."
        tabs={<SettingsNav role={session.role} />}
      />
      <OperationsView />
    </>
  )
}
